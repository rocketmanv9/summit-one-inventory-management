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

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// You decide the war: pick any two vendors, and any items — a catalog item OR an
// ad-hoc free-text line for something not in the catalog yet. No requirement
// that vendors already price the items; the whole point is to go find out.
const CreateRequestSchema = z.object({
  /** Vendors to put in the ring for the whole request. Two minimum. */
  vendor_ids: z.array(z.string().uuid()).min(2).max(12),
  /** The lines to price. Each is a catalog item id OR an ad-hoc label. */
  lines: z
    .array(
      z.object({
        catalog_item_id: z.string().uuid().optional(),
        item_label: z.string().trim().min(1).max(200).optional(),
        target_qty: z.number().positive().max(1_000_000).optional(),
      }).refine((l) => !!l.catalog_item_id || !!l.item_label, {
        message: 'Each line needs a catalog item or an ad-hoc label.',
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
      .select('id, request_id, catalog_item_id, item_label, status, target_qty, baseline_unit_cost, awarded_unit_cost')
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
      item_name: itemMap.get(rd.catalog_item_id)?.name ?? rd.item_label ?? null,
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

  // De-dupe lines: a catalog item by id, an ad-hoc line by its label (folded to
  // lowercase). The same thing twice would just fight itself.
  const seen = new Set<string>();
  const lines = body.lines.filter((l) => {
    const key = l.catalog_item_id ? `c:${l.catalog_item_id}` : `a:${(l.item_label ?? '').toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // ── Validate the vendors we're putting in the ring ──────────────────────────
  // Any active vendor is fair game — no requirement that they already price the
  // items. We just need them to exist so we can address the email.
  const { data: vendorRows, error: vErr } = await sc
    .from('vendors')
    .select('id, name, contact_email, po_email, active')
    .in('id', body.vendor_ids)
    .eq('tenant_id', tenantId)
    .limit(50);
  if (vErr) { log.error('price_wars.vendor_lookup_failed', { error: vErr.message }); throw AppError.internal(vErr.message); }
  const vendorMap = new Map<string, any>((vendorRows ?? []).map((v: any) => [v.id, v]));
  const missingVendors = body.vendor_ids.filter((id) => !vendorMap.has(id));
  if (missingVendors.length > 0) {
    throw AppError.badRequest('One or more selected vendors could not be found for this tenant.');
  }
  if (vendorMap.size < 2) {
    throw AppError.badRequest('Pick at least two vendors — one vendor is not a war.');
  }

  // ── Validate the catalog lines exist; ad-hoc lines carry their own label ─────
  const catalogIds = lines.map((l) => l.catalog_item_id).filter(Boolean) as string[];
  const itemMap = new Map<string, any>();
  if (catalogIds.length > 0) {
    const { data: items, error: iErr } = await (supabase as any)
      .schema('inventory').from('catalog_items').select('id, name, sku').in('id', catalogIds).eq('tenant_id', tenantId).limit(50);
    if (iErr) throw AppError.internal(iErr.message);
    for (const i of items ?? []) itemMap.set(i.id, i);
    const missingItems = catalogIds.filter((id) => !itemMap.has(id));
    if (missingItems.length > 0) throw AppError.badRequest('One or more chosen catalog items could not be found.');
  }

  // ── Best-effort baselines: a standing vendor_items price per (item, vendor),
  // used only to show "their price with us" — never to gate the pick. ──────────
  const priceByItemVendor = new Map<string, number>();
  if (catalogIds.length > 0) {
    const { data: vi } = await sc
      .from('vendor_items')
      .select('catalog_item_id, vendor_id, unit_cost')
      .in('catalog_item_id', catalogIds)
      .in('vendor_id', body.vendor_ids)
      .eq('tenant_id', tenantId)
      .limit(2000);
    for (const row of vi ?? []) {
      const n = row.unit_cost === null ? null : Number(row.unit_cost);
      if (n !== null && Number.isFinite(n)) priceByItemVendor.set(`${row.catalog_item_id}:${row.vendor_id}`, n);
    }
  }

  const lineLabel = (l: (typeof lines)[number]) =>
    l.catalog_item_id ? (itemMap.get(l.catalog_item_id)?.name ?? 'an item') : (l.item_label ?? 'an item');

  // Guard: don't open a second live war over a catalog item already in one.
  if (catalogIds.length > 0) {
    const { data: openRounds } = await sc
      .from('quote_rounds')
      .select('catalog_item_id')
      .eq('tenant_id', tenantId)
      .eq('status', 'open')
      .in('catalog_item_id', catalogIds)
      .limit(100);
    if (openRounds && openRounds.length > 0) {
      const busy = new Set(openRounds.map((r: any) => r.catalog_item_id));
      const names = lines.filter((l) => l.catalog_item_id && busy.has(l.catalog_item_id)).map(lineLabel);
      throw AppError.conflict(`Already fighting over ${names.join(', ')} — close that war first or drop the item.`);
    }
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

  // ── 2. One round per line, each with a bid per vendor ───────────────────────
  const createdRounds: Array<{ round_id: string; catalog_item_id: string | null; item_name: string }> = [];
  try {
    for (const line of lines) {
      const label = lineLabel(line);
      // Round baseline = the highest known vendor price on this item (what we'd
      // otherwise pay), or null when nobody prices it yet.
      const known = line.catalog_item_id
        ? body.vendor_ids.map((vid) => priceByItemVendor.get(`${line.catalog_item_id}:${vid}`)).filter((n): n is number => n !== undefined)
        : [];
      const roundBaseline = known.length > 0 ? Math.max(...known) : null;

      const { data: round, error: rErr } = await sc
        .from('quote_rounds')
        .insert({
          tenant_id: tenantId,
          request_id: request.id,
          catalog_item_id: line.catalog_item_id ?? null,
          item_label: line.catalog_item_id ? null : line.item_label,
          status: 'open',
          target_qty: line.target_qty ?? 1,
          baseline_unit_cost: roundBaseline,
          notes: body.notes ?? null,
          created_by_user_id: ctx.userId,
          last_event_id: crypto.randomUUID(),
        })
        .select('*')
        .single();
      if (rErr) {
        if ((rErr as any).code === '23505') {
          throw AppError.conflict(`A price war is already running for ${label} — drop it from this request.`);
        }
        throw AppError.internal(rErr.message);
      }

      const bidRows = body.vendor_ids.map((vendorId) => {
        const vendor = vendorMap.get(vendorId);
        const baseline = line.catalog_item_id ? priceByItemVendor.get(`${line.catalog_item_id}:${vendorId}`) ?? null : null;
        return {
          tenant_id: tenantId,
          round_id: round.id,
          vendor_id: vendorId,
          status: 'invited',
          baseline_unit_cost: baseline,
          contact_email: (vendor?.contact_email || vendor?.po_email || null),
          last_event_id: crypto.randomUUID(),
        };
      });
      const { error: bErr } = await sc.from('quote_round_bids').insert(bidRows);
      if (bErr) throw AppError.internal(bErr.message);

      createdRounds.push({ round_id: round.id, catalog_item_id: line.catalog_item_id ?? null, item_name: label });
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
