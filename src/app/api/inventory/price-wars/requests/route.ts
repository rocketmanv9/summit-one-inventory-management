/**
 * Quote requests — the multi-product start flow (inventory-fixes sprint, item 02).
 *
 * POST /api/inventory/price-wars/requests
 *   { vendor_ids[2..12], lines: [{ catalog_item_id, target_qty? }][1..12], notes? }
 *
 * "Start a price war" the way it's pictured: pick a couple of vendors, add a few
 * products with quantities like a mini purchase order. This creates ONE parent
 * quote_request plus one quote_round per product (the existing single-item
 * table), each with a bid per invited vendor sharing the same vendor set. The
 * per-item bid/award/draft mechanics are untouched — a request is just a group.
 *
 * Baselines are RE-DERIVED per item from findWarCandidates, never trusted from
 * the client, so every "was $60" the arena shows traces to a real row.
 *
 * GET /api/inventory/price-wars/requests   list requests with their rounds rolled up
 *
 * NOTHING IS SENT HERE and no message is drafted — drafting is the explicit
 * /requests/[id]/draft-rfq call.
 */

import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

import { assertCapability } from '@/lib/access-server';
import { findWarCandidates, rankBids } from '@/lib/price-wars';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const CreateRequestSchema = z.object({
  /** Vendors to put in the ring for the whole request. Two minimum. */
  vendor_ids: z.array(z.string().uuid()).min(2).max(12),
  /** The products, each with an optional target quantity. */
  lines: z
    .array(
      z.object({
        catalog_item_id: z.string().uuid(),
        target_qty: z.number().positive().max(1_000_000).optional(),
      }),
    )
    .min(1)
    .max(12),
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

  let rq = sc
    .from('quote_requests')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (status === 'open') rq = rq.eq('status', 'open');
  if (status === 'closed') rq = rq.in('status', ['closed', 'abandoned']);

  const { data: requests, error } = await rq;
  if (error) { log.error('price_wars.requests_list_failed', { error: error.message }); throw AppError.internal(error.message); }

  const requestIds = (requests ?? []).map((r: any) => r.id);
  const roundsByRequest = new Map<string, any[]>();
  if (requestIds.length > 0) {
    const { data: rounds } = await sc
      .from('quote_rounds')
      .select('id, request_id, catalog_item_id, status, target_qty, baseline_unit_cost, awarded_unit_cost')
      .in('request_id', requestIds)
      .limit(2000);
    for (const r of rounds ?? []) {
      if (!r.request_id) continue;
      if (!roundsByRequest.has(r.request_id)) roundsByRequest.set(r.request_id, []);
      roundsByRequest.get(r.request_id)!.push(r);
    }
  }

  const itemIds = Array.from(new Set(Array.from(roundsByRequest.values()).flat().map((r: any) => r.catalog_item_id)));
  const itemMap = new Map<string, any>();
  if (itemIds.length > 0) {
    const { data: items } = await (supabase as any)
      .schema('inventory').from('catalog_items').select('id, name, sku').in('id', itemIds).limit(2000);
    for (const i of items ?? []) itemMap.set(i.id, i);
  }

  const data = (requests ?? []).map((r: any) => {
    const rounds = (roundsByRequest.get(r.id) ?? []).map((rd: any) => ({
      ...rd,
      item_name: itemMap.get(rd.catalog_item_id)?.name ?? null,
      item_sku: itemMap.get(rd.catalog_item_id)?.sku ?? null,
    }));
    return {
      ...r,
      round_count: rounds.length,
      rounds,
    };
  });

  return Response.json({ data });
}, { serviceName: SERVICE_NAME });

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  await assertCapability(supabase, { tenantId: ctx.tenantId!, userId: ctx.userId! }, 'purchase_orders.manage');
  const body = CreateRequestSchema.parse(await req.json());
  const tenantId = ctx.tenantId!;
  const sc = (supabase as any).schema('supply_chain');

  // De-dupe products — the same item twice would fight itself.
  const seen = new Set<string>();
  const lines = body.lines.filter((l) => {
    if (seen.has(l.catalog_item_id)) return false;
    seen.add(l.catalog_item_id);
    return true;
  });

  // Re-derive real prices for every product up front so baselines are defensible
  // and every selected vendor is proven to have a price on that item.
  const candidateByItem = new Map<string, Awaited<ReturnType<typeof findWarCandidates>>[number]>();
  for (const line of lines) {
    const [candidate] = await findWarCandidates(supabase, tenantId, { catalogItemId: line.catalog_item_id, limit: 1 });
    if (!candidate) {
      throw AppError.badRequest(`"${line.catalog_item_id}" does not have prices from two or more vendors, so there is nothing to bid on.`);
    }
    const priceByVendor = new Map(candidate.vendors.map((v) => [v.vendor_id, v]));
    const unknown = body.vendor_ids.filter((id) => !priceByVendor.has(id));
    if (unknown.length > 0) {
      throw AppError.badRequest(`One or more selected vendors has no recorded price for ${candidate.name}. Pick vendors that already price every product, or drop that product.`);
    }
    candidateByItem.set(line.catalog_item_id, candidate);
  }

  // Guard against products already in a live war before we create the parent.
  const { data: openRounds } = await sc
    .from('quote_rounds')
    .select('catalog_item_id')
    .eq('tenant_id', tenantId)
    .eq('status', 'open')
    .in('catalog_item_id', lines.map((l) => l.catalog_item_id))
    .limit(100);
  if (openRounds && openRounds.length > 0) {
    const busy = new Set(openRounds.map((r: any) => r.catalog_item_id));
    const names = lines.filter((l) => busy.has(l.catalog_item_id)).map((l) => candidateByItem.get(l.catalog_item_id)?.name ?? 'an item');
    throw AppError.conflict(`Already fighting over ${names.join(', ')} — close that war first or drop the product.`);
  }

  // ── 1. Parent request ──────────────────────────────────────────────────────
  const { data: request, error: reqErr } = await sc
    .from('quote_requests')
    .insert({
      tenant_id: tenantId,
      status: 'open',
      vendor_ids: body.vendor_ids,
      notes: body.notes ?? null,
      created_by_user_id: ctx.userId,
      last_event_id: idempotencyKey,
    })
    .select('*')
    .single();
  if (reqErr) { log.error('price_wars.request_create_failed', { error: reqErr.message }); throw AppError.internal(reqErr.message); }

  // ── 2. One round per product, each with a bid per vendor ────────────────────
  const createdRounds: Array<{ round_id: string; catalog_item_id: string; item_name: string }> = [];
  try {
    for (const line of lines) {
      const candidate = candidateByItem.get(line.catalog_item_id)!;
      const priceByVendor = new Map(candidate.vendors.map((v) => [v.vendor_id, v]));

      const { data: round, error: rErr } = await sc
        .from('quote_rounds')
        .insert({
          tenant_id: tenantId,
          request_id: request.id,
          catalog_item_id: line.catalog_item_id,
          status: 'open',
          target_qty: line.target_qty ?? (candidate.qty_last_12m > 0 ? candidate.qty_last_12m : 1),
          baseline_unit_cost: candidate.avg_paid_unit_cost ?? candidate.high_unit_cost,
          notes: body.notes ?? null,
          created_by_user_id: ctx.userId,
          last_event_id: crypto.randomUUID(),
        })
        .select('*')
        .single();
      if (rErr) {
        if ((rErr as any).code === '23505') {
          throw AppError.conflict(`A price war is already running for ${candidate.name} — drop it from this request.`);
        }
        throw AppError.internal(rErr.message);
      }

      const bidRows = body.vendor_ids.map((vendorId) => {
        const v = priceByVendor.get(vendorId)!;
        return {
          tenant_id: tenantId,
          round_id: round.id,
          vendor_id: vendorId,
          status: 'invited',
          baseline_unit_cost: v.last_unit_cost,
          contact_email: v.contact_email,
          last_event_id: crypto.randomUUID(),
        };
      });
      const { error: bErr } = await sc.from('quote_round_bids').insert(bidRows);
      if (bErr) throw AppError.internal(bErr.message);

      createdRounds.push({ round_id: round.id, catalog_item_id: line.catalog_item_id, item_name: candidate.name });
    }
  } catch (err) {
    // Best-effort rollback: cascade-delete the rounds/bids we made, then the
    // parent, so a partial failure doesn't leave orphan wars around.
    log.error('price_wars.request_rounds_failed', { error: (err as Error).message });
    await sc.from('quote_rounds').delete().eq('request_id', request.id).eq('tenant_id', tenantId);
    await sc.from('quote_requests').delete().eq('id', request.id).eq('tenant_id', tenantId);
    throw err instanceof AppError ? err : AppError.internal((err as Error).message);
  }

  return {
    data: {
      request_id: request.id,
      round_count: createdRounds.length,
      vendor_count: body.vendor_ids.length,
      rounds: createdRounds,
      // The first round is the arena entry point for the whole request.
      anchor_round_id: createdRounds[0]?.round_id ?? null,
    },
    status: 201,
    events: [{
      event_name: 'quote_request.opened',
      payload: {
        request_id: request.id,
        vendor_count: body.vendor_ids.length,
        product_count: createdRounds.length,
      },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/price-wars/requests' });
