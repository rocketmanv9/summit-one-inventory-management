/**
 * Quote rounds — the arena roster.
 *
 * GET  /api/inventory/price-wars/rounds        list rounds (+?status=all|open|closed)
 * POST /api/inventory/price-wars/rounds        declare a war on one catalog item
 *
 * Creating a round writes the CURRENT real prices onto each bid as
 * `baseline_unit_cost` so the arena can honestly say "was $60". No message is
 * drafted here and nothing is sent — drafting is a separate, explicit call.
 */

import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

import { assertCapability } from '@/lib/access-server';
import { findWarCandidates, rankBids } from '@/lib/price-wars';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const CreateRoundSchema = z.object({
  catalog_item_id: z.string().uuid(),
  /** Vendors to put in the ring. Two minimum — one vendor isn't a war. */
  vendor_ids: z.array(z.string().uuid()).min(2).max(12),
  target_qty: z.number().positive().max(1_000_000).optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const tenantId = session.tenantId!;
  const status = new URL(req.url).searchParams.get('status') ?? 'all';

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });
  const sc = (supabase as any).schema('supply_chain');

  let query = sc
    .from('quote_rounds')
    // request_id is part of '*' but named here for clarity — the arena groups
    // multi-product wars by it.
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (status === 'open') query = query.eq('status', 'open');
  if (status === 'closed') query = query.in('status', ['awarded', 'abandoned']);

  const { data: rounds, error } = await query;
  if (error) { log.error('price_wars.rounds_list_failed', { error: error.message }); throw AppError.internal(error.message); }

  const roundIds = (rounds ?? []).map((r: any) => r.id);
  const bidsByRound = new Map<string, any[]>();
  const vendorIds = new Set<string>();
  if (roundIds.length > 0) {
    const { data: bids } = await sc
      .from('quote_round_bids')
      .select('id, round_id, vendor_id, status, baseline_unit_cost, current_quote')
      .in('round_id', roundIds)
      .limit(5000);
    for (const b of bids ?? []) {
      if (!bidsByRound.has(b.round_id)) bidsByRound.set(b.round_id, []);
      bidsByRound.get(b.round_id)!.push(b);
      vendorIds.add(b.vendor_id);
    }
  }

  const vendorNames = new Map<string, string>();
  if (vendorIds.size > 0) {
    const { data: vendors } = await sc.from('vendors').select('id, name').in('id', Array.from(vendorIds)).limit(2000);
    for (const v of vendors ?? []) vendorNames.set(v.id, v.name);
  }

  const itemIds = Array.from(new Set((rounds ?? []).map((r: any) => r.catalog_item_id)));
  const itemMap = new Map<string, any>();
  if (itemIds.length > 0) {
    const { data: items } = await (supabase as any)
      .schema('inventory').from('catalog_items').select('id, name, sku').in('id', itemIds).limit(2000);
    for (const i of items ?? []) itemMap.set(i.id, i);
  }

  const data = (rounds ?? []).map((r: any) => {
    const bids = (bidsByRound.get(r.id) ?? []).map((b: any) => ({ ...b, vendor_name: vendorNames.get(b.vendor_id) ?? 'Vendor' }));
    return {
      ...r,
      item_name: itemMap.get(r.catalog_item_id)?.name ?? null,
      item_sku: itemMap.get(r.catalog_item_id)?.sku ?? null,
      awarded_vendor_name: r.awarded_vendor_id ? vendorNames.get(r.awarded_vendor_id) ?? null : null,
      bid_count: bids.length,
      quoted_count: bids.filter((b: any) => b.status === 'quoted').length,
      standings: rankBids(bids),
    };
  });

  return Response.json({ data });
}, { serviceName: SERVICE_NAME });

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  await assertCapability(supabase, { tenantId: ctx.tenantId!, userId: ctx.userId! }, 'purchase_orders.manage');
  const body = CreateRoundSchema.parse(await req.json());
  const tenantId = ctx.tenantId!;
  const sc = (supabase as any).schema('supply_chain');

  // Re-derive the item's real prices rather than trusting client numbers —
  // baselines have to be defensible when the AI cites them back to a vendor.
  const [candidate] = await findWarCandidates(supabase, tenantId, { catalogItemId: body.catalog_item_id, limit: 1 });
  if (!candidate) {
    throw AppError.badRequest('That item does not have prices from two or more vendors, so there is nothing to bid on.');
  }

  const priceByVendor = new Map(candidate.vendors.map((v) => [v.vendor_id, v]));
  const unknown = body.vendor_ids.filter((id) => !priceByVendor.has(id));
  if (unknown.length > 0) {
    throw AppError.badRequest('One or more selected vendors has no recorded price for this item.');
  }

  const { data: round, error } = await sc
    .from('quote_rounds')
    .insert({
      tenant_id: tenantId,
      catalog_item_id: body.catalog_item_id,
      status: 'open',
      // Default to what we actually bought in the last 12 months, so "savings"
      // is grounded; fall back to 1 when we have no purchase history.
      target_qty: body.target_qty ?? (candidate.qty_last_12m > 0 ? candidate.qty_last_12m : 1),
      // "What we pay today" — the blended price we actually paid over the
      // window when there's purchase history, else the worst standing price.
      // This is the number every savings claim in the arena is measured from,
      // so it has to be one we can point at a row for.
      baseline_unit_cost: candidate.avg_paid_unit_cost ?? candidate.high_unit_cost,
      notes: body.notes ?? null,
      created_by_user_id: ctx.userId,
      last_event_id: idempotencyKey,
    })
    .select('*')
    .single();
  if (error) {
    if ((error as any).code === '23505') {
      throw AppError.conflict('A price war is already running for this item — open that round instead.');
    }
    log.error('price_wars.round_create_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  const bidRows = body.vendor_ids.map((vendorId) => {
    const v = priceByVendor.get(vendorId)!;
    return {
      tenant_id: tenantId,
      round_id: round.id,
      vendor_id: vendorId,
      status: 'invited',
      // "What they charge us today" — the catalogue price if there is one,
      // else the last price we paid them.
      baseline_unit_cost: v.last_unit_cost,
      contact_email: v.contact_email,
      last_event_id: crypto.randomUUID(),
    };
  });
  const { error: bErr } = await sc.from('quote_round_bids').insert(bidRows);
  if (bErr) { log.error('price_wars.bids_create_failed', { error: bErr.message }); throw AppError.internal(bErr.message); }

  return {
    data: { round_id: round.id, item_name: candidate.name, vendor_count: bidRows.length },
    status: 201,
    events: [{
      event_name: 'quote_round.opened',
      payload: {
        round_id: round.id,
        catalog_item_id: body.catalog_item_id,
        vendor_count: bidRows.length,
        spread_pct: candidate.spread_pct,
      },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/price-wars/rounds' });
