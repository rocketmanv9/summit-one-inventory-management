import { z } from 'zod';
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { tokens, tokenOverlapScore, singularizedIlikePattern } from '@/lib/ai/item-match';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const VALID_ADJUST_REASONS = ['count_variance', 'damage', 'theft', 'expiration', 'other'];

const ActionSchema = z.object({
  action: z.enum([
    'adjust_stock',
    'adjust_stock_delta',
    'issue_inventory',
    'create_transfer',
    'create_reservation',
    'create_po',
  ]),
  item: z.string().optional(),
  location: z.string().optional(),
  from_location: z.string().optional(),
  to_location: z.string().optional(),
  quantity: z.number().optional(),
  delta: z.number().optional(),
  reason: z.string().optional(),
  notes: z.string().optional(),
  issued_to_type: z.enum(['job', 'truck', 'person', 'other']).optional(),
  issued_to_ref: z.string().optional(),
  job_ref: z.string().optional(),
  allocation_type: z.string().optional(),
  // create_po (name-based path — legacy/keyword flow)
  vendor: z.string().optional(),
  items: z.array(z.object({
    item: z.string(),
    quantity: z.number(),
    unit_cost: z.number().optional(),
  })).optional(),
  // create_po (id-based path — Isabelle draft-PO card, sprint item 03)
  vendor_id: z.string().uuid().optional(),
  delivery_location_id: z.string().uuid().optional(),
  needed_by_date: z.string().max(40).optional(),
  cost_context: z.string().max(60).optional(),
  lines: z.array(z.object({
    catalog_item_id: z.string().uuid(),
    qty_ordered: z.number().positive(),
    unit_cost: z.number().optional(),
    price_basis: z.string().max(40).optional(),
  })).optional(),
});

// POST /api/ai/execute-action
// Isabelle's write bridge: runs everyday stock verbs under the user's session
// (proper tenant/actor auth) so the agent can actually perform them, not just
// hand the user a form. Names are fuzzy-resolved to ids here.
export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const body = ActionSchema.parse(await req.json());
  const inv = (supabase as any).schema('inventory');

  // Resolve an item name/sku to a catalog row. Uses the SAME singularize +
  // token-overlap matcher as recommend-vendor / draft_po_preview (see
  // @/lib/ai/item-match) so "Fuel Cans" resolves to the "Fuel Can" row — a bare
  // `ilike %<raw>%` missed that plural before (defect 2 of the conversational
  // procure fix).
  const resolveItem = async (name?: string): Promise<{ id: string; name: string }> => {
    if (!name) throw AppError.badRequest('An item name is required.');
    const raw = name.trim();

    // 1) Raw ilike on name/sku (handles substrings the caller typed exactly).
    const { data: rawHits, error } = await inv
      .from('catalog_items')
      .select('id, name, sku')
      .or(`name.ilike.%${raw}%,sku.ilike.%${raw}%`)
      .eq('active', true)
      .limit(10);
    if (error) throw AppError.internal(`Item lookup failed: ${error.message}`);
    if (rawHits && rawHits.length > 0) {
      // Prefer the shortest name that contains the query (tightest match).
      const sorted = [...rawHits].sort(
        (a: any, b: any) => (a.name?.length ?? 999) - (b.name?.length ?? 999),
      );
      return { id: sorted[0].id, name: sorted[0].name };
    }

    // 2) Singularized ilike — folds "Fuel Cans" → "%fuel%can%" so the plural
    //    query still catches the singular catalog row.
    const pattern = singularizedIlikePattern(raw);
    if (pattern) {
      const { data: singHits } = await inv
        .from('catalog_items')
        .select('id, name, sku')
        .ilike('name', pattern)
        .eq('active', true)
        .limit(10);
      if (singHits && singHits.length > 0) {
        const sorted = [...singHits].sort(
          (a: any, b: any) => (a.name?.length ?? 999) - (b.name?.length ?? 999),
        );
        return { id: sorted[0].id, name: sorted[0].name };
      }
    }

    // 3) Token-overlap fuzzy over the active catalog — identical scoring to the
    //    recommend-vendor resolver (Jaccard on singularized tokens, ≥0.34).
    if (tokens(raw).length > 0) {
      const { data: all } = await inv
        .from('catalog_items')
        .select('id, name')
        .eq('active', true)
        .limit(5000);
      let best: { row: any; score: number } | null = null;
      for (const row of all ?? []) {
        const score = tokenOverlapScore(raw, row.name ?? '');
        if (score > 0 && (!best || score > best.score)) best = { row, score };
      }
      if (best && best.score >= 0.34) return { id: best.row.id, name: best.row.name };
    }

    throw AppError.notFound(`Item "${name}" not found.`);
  };

  // Resolve the tenant's default ship-to location for a `ship` PO when the caller
  // didn't pass one — mirrors draft_po_preview's resolver (is_default_ship_to,
  // else any active location). rpc_create_purchase_order requires a
  // delivery_location_id when delivery_method='ship', and the conversational
  // create path never supplied one (defect 1).
  const resolveDefaultDeliveryLocation = async (
    given?: string | null,
  ): Promise<string | null> => {
    if (given && UUID_RE.test(given)) {
      const { data } = await inv
        .from('locations')
        .select('id')
        .eq('tenant_id', ctx.tenantId)
        .eq('id', given)
        .limit(1)
        .maybeSingle();
      if (data) return data.id;
    }
    const { data: def } = await inv
      .from('locations')
      .select('id')
      .eq('tenant_id', ctx.tenantId)
      .eq('is_default_ship_to', true)
      .eq('active', true)
      .limit(1)
      .maybeSingle();
    if (def) return def.id;
    const { data: any1 } = await inv
      .from('locations')
      .select('id')
      .eq('tenant_id', ctx.tenantId)
      .eq('active', true)
      .limit(1)
      .maybeSingle();
    return any1?.id ?? null;
  };

  const resolveLocation = async (name?: string, label = 'location'): Promise<{ id: string; name: string }> => {
    if (!name) throw AppError.badRequest(`A ${label} name is required.`);
    const { data, error } = await inv
      .from('locations')
      .select('id, name')
      .ilike('name', `%${name}%`)
      .eq('active', true)
      .limit(1);
    if (error) throw AppError.internal(`Location lookup failed: ${error.message}`);
    if (!data || data.length === 0) throw AppError.notFound(`Location "${name}" not found.`);
    return { id: data[0].id, name: data[0].name };
  };

  const currentQty = async (itemId: string, locationId: string): Promise<number> => {
    const { data } = await inv
      .from('stock_balances')
      .select('qty_on_hand')
      .eq('catalog_item_id', itemId)
      .eq('location_id', locationId)
      .limit(1);
    return data && data.length > 0 ? Number(data[0].qty_on_hand) || 0 : 0;
  };

  switch (body.action) {
    // ── Set on-hand to an exact quantity ──────────────────────────────
    case 'adjust_stock': {
      if (body.quantity == null || body.quantity < 0) throw AppError.badRequest('A non-negative quantity is required.');
      const item = await resolveItem(body.item);
      const loc = await resolveLocation(body.location);
      const reason = VALID_ADJUST_REASONS.includes(body.reason || '') ? body.reason : 'other';
      const prev = await currentQty(item.id, loc.id);
      const { error } = await inv.rpc('rpc_adjust_inventory', {
        p_catalog_item_id: item.id,
        p_location_id: loc.id,
        p_new_qty: body.quantity,
        p_reason: reason,
        p_notes: body.notes || `Set via Isabelle (was ${prev})`,
      });
      if (error) throw AppError.internal(`Adjust failed: ${error.message}`);
      return {
        data: { item: item.name, location: loc.name, previous_qty: prev, new_qty: body.quantity } as Record<string, unknown>,
        status: 200,
        events: [{
          event_name: 'stock.adjusted_via_ai',
          payload: { item_id: item.id, location_id: loc.id, previous_qty: prev, new_qty: body.quantity, reason },
          last_event_id: idempotencyKey,
        }],
      };
    }

    // ── Add/subtract from current on-hand ─────────────────────────────
    case 'adjust_stock_delta': {
      if (body.delta == null || body.delta === 0) throw AppError.badRequest('A non-zero delta is required.');
      const item = await resolveItem(body.item);
      const loc = await resolveLocation(body.location);
      const reason = VALID_ADJUST_REASONS.includes(body.reason || '') ? body.reason : 'other';
      const prev = await currentQty(item.id, loc.id);
      const newQty = Math.max(0, prev + body.delta);
      const { error } = await inv.rpc('rpc_adjust_inventory', {
        p_catalog_item_id: item.id,
        p_location_id: loc.id,
        p_new_qty: newQty,
        p_reason: reason,
        p_notes: body.notes || `${body.delta > 0 ? '+' : ''}${body.delta} via Isabelle`,
      });
      if (error) throw AppError.internal(`Adjust failed: ${error.message}`);
      return {
        data: { item: item.name, location: loc.name, previous_qty: prev, new_qty: newQty, delta: body.delta } as Record<string, unknown>,
        status: 200,
        events: [{
          event_name: 'stock.adjusted_via_ai',
          payload: { item_id: item.id, location_id: loc.id, previous_qty: prev, new_qty: newQty, reason },
          last_event_id: idempotencyKey,
        }],
      };
    }

    // ── Issue/release stock to a job, truck, or person ────────────────
    case 'issue_inventory': {
      if (body.quantity == null || body.quantity <= 0) throw AppError.badRequest('A positive quantity is required.');
      const item = await resolveItem(body.item);
      const loc = await resolveLocation(body.location);
      const { data, error } = await inv.rpc('rpc_issue_inventory', {
        p_location_id: loc.id,
        p_items: [{ catalog_item_id: item.id, qty_issued: body.quantity }],
        p_issued_to_type: body.issued_to_type || 'other',
        p_issued_to_ref: body.issued_to_ref || 'Issued via Isabelle',
        p_reason: body.reason || 'issue',
        p_notes: body.notes || null,
      });
      if (error) throw AppError.internal(`Issue failed: ${error.message}`);
      return {
        data: { item: item.name, location: loc.name, quantity: body.quantity, issued_to: body.issued_to_ref, result: data } as Record<string, unknown>,
        status: 200,
        events: [{
          event_name: 'inventory.issued_via_ai',
          payload: { item_id: item.id, location_id: loc.id, quantity: body.quantity, issued_to_type: body.issued_to_type || 'other', issued_to_ref: body.issued_to_ref || null },
          last_event_id: idempotencyKey,
        }],
      };
    }

    // ── Transfer stock between two locations ──────────────────────────
    case 'create_transfer': {
      if (body.quantity == null || body.quantity <= 0) throw AppError.badRequest('A positive quantity is required.');
      const item = await resolveItem(body.item);
      const from = await resolveLocation(body.from_location, 'source location');
      const to = await resolveLocation(body.to_location, 'destination location');
      if (from.id === to.id) throw AppError.badRequest('Source and destination locations must differ.');
      const { data, error } = await inv.rpc('rpc_inv_transfer_create', {
        p_tenant_id: ctx.tenantId,
        p_from_location_id: from.id,
        p_to_location_id: to.id,
        p_lines: [{ catalog_item_id: item.id, qty: body.quantity }],
        p_initiated_by_user_id: ctx.userId,
        p_notes: body.notes || null,
        p_last_event_id: `${idempotencyKey}_txn`,
      });
      if (error) throw AppError.internal(`Transfer failed: ${error.message}`);
      return {
        data: { transfer_id: data, item: item.name, from: from.name, to: to.name, quantity: body.quantity } as Record<string, unknown>,
        status: 201,
        events: [{
          event_name: 'transfer.created_via_ai',
          payload: { transfer_id: data, item_id: item.id, from_location_id: from.id, to_location_id: to.id, quantity: body.quantity },
          last_event_id: idempotencyKey,
        }],
      };
    }

    // ── Reserve fungible stock for a job/purpose ──────────────────────
    case 'create_reservation': {
      if (body.quantity == null || body.quantity <= 0) throw AppError.badRequest('A positive quantity is required.');
      const item = await resolveItem(body.item);
      const loc = await resolveLocation(body.location);
      const { data, error } = await inv.rpc('rpc_inv_reserve_fungible', {
        p_tenant_id: ctx.tenantId,
        p_catalog_item_id: item.id,
        p_location_id: loc.id,
        p_qty: body.quantity,
        p_allocation_type: body.allocation_type || 'other',
        p_job_ref: body.job_ref || null,
        p_external_order_ref: null,
        p_needed_by: null,
        p_expiration_date: null,
        p_reserved_from: null,
        p_reserved_until: null,
        p_notes: body.notes || null,
        p_destination_location_id: null,
        p_last_event_id: `${idempotencyKey}_resv`,
      });
      if (error) throw AppError.internal(`Reservation failed: ${error.message}`);
      return {
        data: { reservation_id: data, item: item.name, location: loc.name, quantity: body.quantity, job_ref: body.job_ref } as Record<string, unknown>,
        status: 201,
        events: [{
          event_name: 'reservation.created_via_ai',
          payload: { reservation_id: data, item_id: item.id, location_id: loc.id, quantity: body.quantity },
          last_event_id: idempotencyKey,
        }],
      };
    }

    // ── Create a draft purchase order for a vendor ────────────────────
    // Two shapes converge here:
    //  • id-based (Isabelle draft-PO card, item 03): vendor_id + delivery_location_id
    //    + lines[{ catalog_item_id, qty_ordered, unit_cost?, price_basis? }].
    //  • name-based (legacy keyword flow): vendor (name) + items[{ item, quantity }].
    case 'create_po': {
      const sc = (supabase as any).schema('supply_chain');

      // Resolve the vendor by id (card) or fuzzy name (keyword flow).
      let vendor: { id: string; name: string };
      if (body.vendor_id) {
        const { data: v, error: vErr } = await sc
          .from('vendors')
          .select('id, name')
          .eq('tenant_id', ctx.tenantId)
          .eq('id', body.vendor_id)
          .limit(1)
          .maybeSingle();
        if (vErr) throw AppError.internal(`Vendor lookup failed: ${vErr.message}`);
        if (!v) throw AppError.notFound('That vendor is no longer on file.');
        vendor = { id: v.id, name: v.name };
      } else if (body.vendor) {
        const { data: vendors, error: vErr } = await sc
          .from('vendors')
          .select('id, name')
          .ilike('name', `%${body.vendor}%`)
          .limit(1);
        if (vErr) throw AppError.internal(`Vendor lookup failed: ${vErr.message}`);
        if (!vendors || vendors.length === 0) throw AppError.notFound(`Vendor "${body.vendor}" not found.`);
        vendor = { id: vendors[0].id, name: vendors[0].name };
      } else {
        throw AppError.badRequest('A vendor is required.');
      }

      // Build PO lines from whichever shape was provided.
      const lines: any[] = [];
      if (body.lines && body.lines.length > 0) {
        // id-based: catalog_item_id + qty_ordered are already resolved by the card.
        for (const reqLine of body.lines) {
          lines.push({
            catalog_item_id: reqLine.catalog_item_id,
            qty_ordered: reqLine.qty_ordered,
            unit_cost: reqLine.unit_cost ?? null,
            price_basis: reqLine.price_basis || (reqLine.unit_cost != null ? 'fixed' : 'unknown'),
          });
        }
      } else {
        // name-based: fuzzy-resolve each item name to a catalog id.
        for (const reqLine of body.items || []) {
          const item = await resolveItem(reqLine.item);
          lines.push({
            catalog_item_id: item.id,
            qty_ordered: reqLine.quantity,
            unit_cost: reqLine.unit_cost ?? null,
            price_basis: reqLine.unit_cost != null ? 'fixed' : 'unknown',
          });
        }
      }
      if (lines.length === 0) throw AppError.badRequest('At least one line is required.');

      // rpc_create_purchase_order rejects delivery_method='ship' with no
      // delivery_location_id. The conversational create path never supplied one,
      // so resolve the tenant's default ship-to (or any active location) here —
      // the same default draft_po_preview shows — before calling the RPC (defect 1).
      const deliveryLocationId = await resolveDefaultDeliveryLocation(body.delivery_location_id);
      if (!deliveryLocationId) {
        throw AppError.badRequest(
          'No delivery location is set up yet — add a location (or mark one as the default ship-to) and I can create the PO.',
        );
      }

      const { data: po, error: poErr } = await sc.rpc('rpc_create_purchase_order', {
        p_vendor_id: vendor.id,
        p_po_number: null,
        p_delivery_method: 'ship',
        p_needed_by_date: body.needed_by_date || null,
        p_cost_context: body.cost_context || 'yard',
        p_job_id: null,
        p_delivery_location_id: deliveryLocationId,
        p_pickup_location_id: null,
        p_max_authorized_spend: null,
        p_vendor_quote_ref: null,
        p_notes: body.notes || 'Created via Isabelle',
        p_attachments: [],
        p_lines: lines,
        // The route's supabase is a tenant service client — its JWT carries no
        // tenant/user claims, so pass the acting identity explicitly
        // (service_role-only params; see 20260804000004_ai_restock_orders).
        p_tenant_id: ctx.tenantId,
        p_acting_user_id: ctx.userId,
      });
      if (poErr) throw AppError.internal(`PO creation failed: ${poErr.message}`);

      const poId = (po as any)?.po_id || (po as any)?.id || po;
      const poNumber = (po as any)?.po_number || null;
      // status may be draft / approved / awaiting_approval depending on tenant
      // auto-approve + spend limits — surface it honestly for the card.
      const poStatus = (po as any)?.status || 'draft';
      return {
        data: { po_id: poId, po_number: poNumber, status: poStatus, vendor: vendor.name, line_count: lines.length } as Record<string, unknown>,
        status: 201,
        events: [{
          event_name: 'po.created_via_ai',
          payload: { po_id: poId, po_number: poNumber, status: poStatus, vendor_id: vendor.id, line_count: lines.length },
          last_event_id: idempotencyKey,
        }],
      };
    }

    default:
      throw AppError.badRequest(`Unknown action: ${(body as any).action}`);
  }
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/ai/execute-action' });
