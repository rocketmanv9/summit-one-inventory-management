/**
 * POST /api/inventory/price-wars/rounds/:id/award
 *   { vendor_id, unit_cost?, create_po?: boolean, delivery_location_id?, qty? }
 *
 * Somebody won. Three things happen, in this order:
 *   1. the round closes with the winner and the winning price on it;
 *   2. supply_chain.vendor_items is updated (or created) for that vendor+item at
 *      the winning unit_cost — the whole point, otherwise the next PO reverts to
 *      the old price;
 *   3. optionally a DRAFT purchase order through rpc_create_purchase_order, so
 *      it lands in the normal approval flow. Never sent, never auto-approved.
 *
 * `unit_cost` defaults to the price the winner actually quoted in the round. A
 * supplied override still has to be a number a human typed here.
 */

import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

import { assertCapability } from '@/lib/access-server';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function extractId(req: Request): string {
  const segs = new URL(req.url).pathname.split('/');
  const id = segs[segs.indexOf('rounds') + 1];
  if (!id) throw AppError.badRequest('Missing round id');
  return z.string().uuid().parse(id);
}

const AwardSchema = z.object({
  vendor_id: z.string().uuid(),
  unit_cost: z.number().positive().max(10_000_000).optional(),
  create_po: z.boolean().optional(),
  delivery_location_id: z.string().uuid().nullable().optional(),
  qty: z.number().positive().max(1_000_000).optional(),
});

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  await assertCapability(supabase, { tenantId: ctx.tenantId!, userId: ctx.userId! }, 'purchase_orders.manage');
  const roundId = extractId(req);
  const body = AwardSchema.parse(await req.json());
  const tenantId = ctx.tenantId!;
  const userId = ctx.userId!;
  const sc = (supabase as any).schema('supply_chain');

  const { data: round, error: rErr } = await sc
    .from('quote_rounds').select('*').eq('id', roundId).eq('tenant_id', tenantId).maybeSingle();
  if (rErr) throw AppError.internal(rErr.message);
  if (!round) throw AppError.notFound('Price war not found');
  if (round.status !== 'open') throw AppError.conflict('This price war has already been closed.');

  const { data: bids, error: bErr } = await sc
    .from('quote_round_bids').select('*').eq('round_id', roundId).limit(100);
  if (bErr) throw AppError.internal(bErr.message);

  const winner = (bids ?? []).find((b: any) => b.vendor_id === body.vendor_id);
  if (!winner) throw AppError.badRequest('That vendor is not in this round.');

  const quoted = winner.current_quote !== null && winner.current_quote !== undefined ? Number(winner.current_quote) : null;
  const unitCost = body.unit_cost ?? quoted;
  if (unitCost === null || !Number.isFinite(unitCost)) {
    throw AppError.badRequest('That vendor has no recorded quote — record their price first, or pass an explicit unit_cost.');
  }

  const now = new Date().toISOString();

  // ── 1. Update the standing price ───────────────────────────────────────────
  // Look before writing: vendor_items is uniquely keyed on
  // (tenant_id, vendor_id, catalog_item_id, vendor_address_id) with NULLS NOT
  // DISTINCT, so a blind upsert would need to guess the address. Merge instead.
  const { data: existing } = await sc
    .from('vendor_items')
    .select('id, unit_cost')
    .eq('tenant_id', tenantId)
    .eq('vendor_id', body.vendor_id)
    .eq('catalog_item_id', round.catalog_item_id)
    .limit(1);

  let vendorItemId: string | null = null;
  let previousCost: number | null = null;
  if (existing && existing.length > 0) {
    previousCost = existing[0].unit_cost !== null ? Number(existing[0].unit_cost) : null;
    const { error } = await sc
      .from('vendor_items')
      .update({
        unit_cost: unitCost,
        last_known_price: unitCost,
        price_checked_at: now,
        updated_at: now,
      })
      .eq('id', existing[0].id);
    if (error) { log.error('price_wars.vendor_item_update_failed', { error: error.message }); throw AppError.internal(error.message); }
    vendorItemId = existing[0].id;
  } else {
    const { data: inserted, error } = await sc
      .from('vendor_items')
      .insert({
        tenant_id: tenantId,
        vendor_id: body.vendor_id,
        catalog_item_id: round.catalog_item_id,
        unit_cost: unitCost,
        last_known_price: unitCost,
        price_checked_at: now,
        currency: 'USD',
        active: true,
        notes: 'Price won in a competitive quote round',
        last_event_id: idempotencyKey,
      })
      .select('id')
      .single();
    if (error) { log.error('price_wars.vendor_item_insert_failed', { error: error.message }); throw AppError.internal(error.message); }
    vendorItemId = inserted?.id ?? null;
  }

  // ── 2. Close the round ─────────────────────────────────────────────────────
  const { error: closeErr } = await sc
    .from('quote_rounds')
    .update({
      status: 'awarded',
      awarded_vendor_id: body.vendor_id,
      awarded_unit_cost: unitCost,
      closed_at: now,
      updated_at: now,
      last_event_id: idempotencyKey,
    })
    .eq('id', roundId)
    .eq('tenant_id', tenantId);
  if (closeErr) { log.error('price_wars.round_close_failed', { error: closeErr.message }); throw AppError.internal(closeErr.message); }

  // ── 3. Optional draft PO at the winning price ──────────────────────────────
  let po: { po_id: string | null; po_number: string | null; status: string | null } | null = null;
  if (body.create_po) {
    let deliveryLocationId = body.delivery_location_id ?? null;
    if (!deliveryLocationId) {
      const { data: loc } = await (supabase as any)
        .schema('inventory').from('locations').select('id').eq('tenant_id', tenantId).limit(1);
      deliveryLocationId = loc?.[0]?.id ?? null;
    }
    if (!deliveryLocationId) throw AppError.badRequest('No delivery location available for the draft PO.');

    const qty = body.qty ?? (Number(round.target_qty) || 1);
    const { data: poResult, error: poErr } = await sc.rpc('rpc_create_purchase_order', {
      p_vendor_id: body.vendor_id,
      p_delivery_method: 'ship',
      p_delivery_location_id: deliveryLocationId,
      p_cost_context: 'overhead',
      // rpc_create_purchase_order decides draft vs awaiting_approval from the
      // buyer's spending limit — we do not force either. Nothing is sent to the
      // vendor from here; approval is still a human step.
      p_notes: `Won a competitive quote round at $${unitCost.toFixed(2)}/unit (was ${previousCost !== null ? `$${previousCost.toFixed(2)}` : 'unpriced'}). Nothing has been sent to the vendor — this goes through the normal approval flow.`,
      p_lines: [{
        catalog_item_id: round.catalog_item_id,
        qty_ordered: qty,
        unit_cost: unitCost,
        price_basis: 'fixed',
        line_notes: 'Price war winner',
      }],
      p_initiated_by: 'user',
      p_tenant_id: tenantId,
      p_acting_user_id: userId,
    });
    if (poErr) { log.error('price_wars.award_po_failed', { error: poErr.message }); throw AppError.internal(`Draft PO creation failed: ${poErr.message}`); }
    po = { po_id: poResult?.po_id ?? null, po_number: poResult?.po_number ?? null, status: poResult?.status ?? null };

    if (po.po_id) {
      await sc.from('quote_rounds').update({ awarded_po_id: po.po_id }).eq('id', roundId).eq('tenant_id', tenantId);
    }
  }

  const baseline = winner.baseline_unit_cost !== null ? Number(winner.baseline_unit_cost) : null;
  const targetQty = Number(round.target_qty) || 1;
  const saved = baseline !== null ? Math.max(0, (baseline - unitCost) * targetQty) : null;

  return {
    data: {
      round_id: roundId,
      vendor_id: body.vendor_id,
      unit_cost: unitCost,
      previous_unit_cost: previousCost,
      vendor_item_id: vendorItemId,
      estimated_annual_savings: saved !== null ? Math.round(saved * 100) / 100 : null,
      purchase_order: po,
    },
    status: 200,
    events: [{
      event_name: 'quote_round.awarded',
      payload: {
        round_id: roundId,
        catalog_item_id: round.catalog_item_id,
        vendor_id: body.vendor_id,
        unit_cost: unitCost,
        po_id: po?.po_id ?? null,
      },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/price-wars/rounds/[id]/award' });
