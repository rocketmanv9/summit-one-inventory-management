/**
 * One quote round — the arena.
 *
 * GET   /api/inventory/price-wars/rounds/:id   full leaderboard + drafts + history
 * PATCH /api/inventory/price-wars/rounds/:id   record a quote / decline / abandon
 *
 * PATCH is the ONLY way a number enters a round, and it always comes from a
 * human: they typed it, or they confirmed what /extract-quote read out of a
 * pasted vendor reply. The AI never writes a price.
 */

import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

import { assertCapability } from '@/lib/access-server';
import { findWarCandidates, rankBids, currentLow, roundSavings, recommendWinner } from '@/lib/price-wars';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function extractId(req: Request): string {
  const segs = new URL(req.url).pathname.split('/');
  const id = segs[segs.indexOf('rounds') + 1];
  if (!id) throw AppError.badRequest('Missing round id');
  return z.string().uuid().parse(id);
}

const PatchSchema = z.object({
  /** Record a response for one vendor. */
  bid_id: z.string().uuid().optional(),
  quote: z.object({
    unit_cost: z.number().positive().max(10_000_000),
    source: z.enum(['manual', 'extracted']).optional(),
    moq: z.number().positive().nullable().optional(),
    lead_time_days: z.number().int().nonnegative().nullable().optional(),
    confidence: z.number().min(0).max(100).nullable().optional(),
    raw: z.string().max(8000).nullable().optional(),
  }).optional(),
  /** Mark a vendor as out of the running. */
  declined: z.boolean().optional(),
  bid_notes: z.string().max(2000).nullable().optional(),
  /** Round-level edits. */
  target_qty: z.number().positive().max(1_000_000).optional(),
  notes: z.string().max(2000).nullable().optional(),
  abandon: z.boolean().optional(),
});

async function loadRound(supabase: any, tenantId: string, id: string) {
  const sc = supabase.schema('supply_chain');
  const { data: round, error } = await sc
    .from('quote_rounds').select('*').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
  if (error) throw AppError.internal(error.message);
  if (!round) throw AppError.notFound('Price war not found');

  const { data: bids, error: bErr } = await sc
    .from('quote_round_bids').select('*').eq('round_id', id).limit(100);
  if (bErr) throw AppError.internal(bErr.message);

  const vendorIds = (bids ?? []).map((b: any) => b.vendor_id);
  const vendorMap = new Map<string, any>();
  if (vendorIds.length > 0) {
    const { data: vendors } = await sc
      .from('vendors')
      .select('id, name, code, contact_name, contact_email, po_email, lead_time_days, payment_terms')
      .in('id', vendorIds).limit(100);
    for (const v of vendors ?? []) vendorMap.set(v.id, v);
  }

  const { data: item } = await supabase
    .schema('inventory').from('catalog_items').select('id, name, sku, description')
    .eq('id', round.catalog_item_id).maybeSingle();

  const enriched = (bids ?? []).map((b: any) => {
    const v = vendorMap.get(b.vendor_id);
    return {
      ...b,
      vendor_name: v?.name ?? 'Vendor',
      vendor_code: v?.code ?? null,
      vendor_contact_name: v?.contact_name ?? null,
      // The bid's own contact_email is snapshotted at invite time; fall back to
      // whatever the vendor record says now.
      contact_email: b.contact_email ?? v?.contact_email ?? v?.po_email ?? null,
      payment_terms: v?.payment_terms ?? null,
    };
  });

  return { round, bids: enriched, item };
}

export const GET = createSessionReadRoute(async ({ req, session }) => {
  const tenantId = session.tenantId!;
  const id = extractId(req);
  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });

  const { round, bids, item } = await loadRound(supabase, tenantId, id);
  const standings = rankBids(bids);
  const low = currentLow(bids);

  // Live market context, so the arena can show a vendor who was never invited
  // still sitting cheaper than everyone in the ring.
  const [candidate] = await findWarCandidates(supabase, tenantId, { catalogItemId: round.catalog_item_id, limit: 1 });

  const targetQty = Number(round.target_qty) || 1;
  const baseline = round.baseline_unit_cost !== null ? Number(round.baseline_unit_cost) : null;

  return Response.json({
    data: {
      round: {
        ...round,
        item_name: item?.name ?? null,
        item_sku: item?.sku ?? null,
        awarded_vendor_name: round.awarded_vendor_id
          ? bids.find((b: any) => b.vendor_id === round.awarded_vendor_id)?.vendor_name ?? null
          : null,
      },
      bids,
      standings,
      current_low: low,
      savings_so_far: roundSavings(targetQty, baseline, low?.unit_cost ?? null),
      // Who's best, once replies are in — the decision Grant confirms. Only real
      // recorded quotes are eligible; empty until someone actually quotes.
      recommendation: recommendWinner(bids, { targetQty, baseline }),
      market: candidate ?? null,
    },
  });
}, { serviceName: SERVICE_NAME });

export const PATCH = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  await assertCapability(supabase, { tenantId: ctx.tenantId!, userId: ctx.userId! }, 'purchase_orders.manage');
  const id = extractId(req);
  const body = PatchSchema.parse(await req.json());
  const tenantId = ctx.tenantId!;
  const sc = (supabase as any).schema('supply_chain');

  const { round, bids } = await loadRound(supabase, tenantId, id);
  if (round.status !== 'open') {
    throw AppError.conflict('This price war is closed — reopen is not supported; start a new round.');
  }

  const now = new Date().toISOString();
  const eventPayloads: any[] = [];

  // ── Record one vendor's response ───────────────────────────────────────────
  if (body.bid_id) {
    const bid = bids.find((b: any) => b.id === body.bid_id);
    if (!bid) throw AppError.notFound('That vendor is not in this round');

    const updates: Record<string, unknown> = { updated_at: now, last_event_id: idempotencyKey };
    if (body.bid_notes !== undefined) updates.notes = body.bid_notes;

    if (body.declined) {
      updates.status = 'declined';
    } else if (body.quote) {
      const entry = {
        unit_cost: body.quote.unit_cost,
        recorded_at: now,
        source: body.quote.source ?? 'manual',
        recorded_by_user_id: ctx.userId ?? null,
        moq: body.quote.moq ?? null,
        lead_time_days: body.quote.lead_time_days ?? null,
        confidence: body.quote.confidence ?? null,
        raw: body.quote.raw ? String(body.quote.raw).slice(0, 4000) : null,
      };
      updates.status = 'quoted';
      updates.current_quote = body.quote.unit_cost;
      updates.quote_history = [...(Array.isArray(bid.quote_history) ? bid.quote_history : []), entry];
      eventPayloads.push({
        event_name: 'quote_round.quote_recorded',
        payload: { round_id: id, vendor_id: bid.vendor_id, unit_cost: body.quote.unit_cost, source: entry.source },
        last_event_id: idempotencyKey,
      });
    }

    const { error } = await sc.from('quote_round_bids').update(updates).eq('id', body.bid_id).eq('tenant_id', tenantId);
    if (error) { log.error('price_wars.bid_update_failed', { error: error.message }); throw AppError.internal(error.message); }
  }

  // ── Round-level edits ──────────────────────────────────────────────────────
  const roundUpdates: Record<string, unknown> = {};
  if (body.target_qty !== undefined) roundUpdates.target_qty = body.target_qty;
  if (body.notes !== undefined) roundUpdates.notes = body.notes;
  if (body.abandon) {
    roundUpdates.status = 'abandoned';
    roundUpdates.closed_at = now;
  }
  if (Object.keys(roundUpdates).length > 0) {
    roundUpdates.updated_at = now;
    roundUpdates.last_event_id = idempotencyKey;
    const { error } = await sc.from('quote_rounds').update(roundUpdates).eq('id', id).eq('tenant_id', tenantId);
    if (error) { log.error('price_wars.round_update_failed', { error: error.message }); throw AppError.internal(error.message); }
  }

  const fresh = await loadRound(supabase, tenantId, id);
  const low = currentLow(fresh.bids);

  return {
    data: {
      round: fresh.round,
      standings: rankBids(fresh.bids),
      current_low: low,
      savings_so_far: roundSavings(
        Number(fresh.round.target_qty) || 1,
        fresh.round.baseline_unit_cost !== null ? Number(fresh.round.baseline_unit_cost) : null,
        low?.unit_cost ?? null,
      ),
    },
    status: 200,
    events: eventPayloads,
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'PATCH /api/inventory/price-wars/rounds/[id]' });
