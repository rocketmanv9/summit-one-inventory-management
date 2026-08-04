/**
 * Submit Amazon Business cXML OrderRequest
 * POST — build and POST the OrderRequest using SPAID from the returned POOM
 */
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { getAdminClient } from '@/utils/supabase/admin';
import { resolveCxmlCredentials, roundToPackQuantity } from '@/lib/integrations/amazon-business';
import {
  buildOrderRequest,
  parseOrderResponse,
  postCxml,
  normalizeStateCode,
  normalizeCountryCode,
  validateShipToAddress,
  type OrderRequestLineItem,
} from '@/lib/integrations/amazon-cxml';
import { applyInheritedAddress } from '@/lib/locations/resolve-address';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const SubmitSchema = z.object({
  punchout_order_id: z.string().uuid(),
  location_id: z.string().uuid(),
  existing_po_id: z.string().uuid().optional(),
});

export const POST = createSessionWriteRoute(async ({ req, ctx, log, idempotencyKey }) => {
  const body = SubmitSchema.parse(await req.json());
  const adminClient = getAdminClient();
  const inv = (adminClient as any).schema('inventory');
  const sc = (adminClient as any).schema('supply_chain');

  // 1. Load the punchout order
  const { data: order, error: orderError } = await inv
    .from('punchout_orders')
    .select('*')
    .eq('id', body.punchout_order_id)
    .eq('tenant_id', ctx.tenantId!)
    .limit(1)
    .single();

  if (orderError || !order) throw AppError.notFound('Punchout order not found.');

  if (order.status !== 'cart_returned') {
    throw AppError.badRequest(
      `Cannot submit order in status "${order.status}". Expected "cart_returned".`
    );
  }

  const poomItems = order.poom_items as Array<{
    line_number: number;
    supplier_sku: string;
    spaid: string;
    quantity: number;
    unit_price: number;
    currency: string;
    description: string;
    unit_of_measure: string;
  }>;

  if (!poomItems?.length) {
    throw AppError.badRequest('No items in the returned cart. Cannot submit an empty order.');
  }

  // 2. Resolve cXML credentials
  const cxmlConfig = await resolveCxmlCredentials(adminClient, ctx.tenantId!);

  if (!cxmlConfig.poRequestUrl) {
    throw AppError.badRequest('PO Request URL not configured. Update in Settings > Integrations.');
  }

  // 3. Load shipping address
  const { data: location, error: locError } = await inv
    .from('locations')
    .select('id, name, parent_location_id, address_line_1, address_line_2, city, state, postal_code, country')
    .eq('id', body.location_id)
    .eq('tenant_id', ctx.tenantId!)
    .limit(1)
    .single();

  if (locError || !location) throw AppError.notFound('Delivery location not found.');

  // A child location inherits its parent's address when it has none of its own.
  const eff = await applyInheritedAddress(inv, ctx.tenantId!, location);

  // Reject incomplete, unrecognized-state, or state/ZIP-mismatched addresses with an
  // actionable message instead of a cryptic Amazon 003-052 rejection on submit.
  validateShipToAddress(eff, location.name);

  const normalizedCountry = normalizeCountryCode(eff.country || 'US');
  const normalizedState = normalizeStateCode(eff.state);

  const shipTo = {
    name: location.name,
    address_line_1: eff.address_line_1,
    address_line_2: eff.address_line_2 || undefined,
    city: eff.city,
    state: normalizedState,
    postal_code: eff.postal_code,
    country: normalizedCountry,
    addressId: location.id,
    deliverTo: location.name,
  };

  // 4. Optionally resolve pack quantities from vendor_items
  const prov = (adminClient as any).schema('provisioning');
  const asins = poomItems.map((i) => i.supplier_sku);

  const { data: vendorItems } = await sc
    .from('vendor_items')
    .select('vendor_sku, pack_size, catalog_item_id')
    .eq('tenant_id', ctx.tenantId!)
    .in('vendor_sku', asins)
    .limit(100);

  const packMap = new Map<string, number>(
    (vendorItems || []).map((vi: any) => [vi.vendor_sku, Number(vi.pack_size) || 1])
  );
  // ASIN → catalog item, for reconciling the PO's lines with the ordered cart.
  const asinToCatalogItem = new Map<string, string>(
    (vendorItems || [])
      .filter((vi: any) => vi.catalog_item_id)
      .map((vi: any) => [vi.vendor_sku, vi.catalog_item_id])
  );

  // 5. Build OrderRequest line items with pack-qty rounding
  const orderLines: OrderRequestLineItem[] = poomItems.map((item) => {
    const packQty = packMap.get(item.supplier_sku) || 1;
    const roundedQty = roundToPackQuantity(item.quantity, packQty);
    return {
      supplierSku: item.supplier_sku,
      spaid: item.spaid,
      quantity: roundedQty,
      unitPrice: item.unit_price,
      currency: item.currency,
      description: item.description,
      unitOfMeasure: item.unit_of_measure,
      lineNumber: item.line_number,
    };
  });

  const total = orderLines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);

  // 6. Use existing PO or create a new internal PO
  let poId: string | null = null;
  let poNumber: string | null = null;

  if (body.existing_po_id) {
    // Use existing PO (called from PlaceOrderModal on an approved PO)
    const { data: existingPO, error: existingPOError } = await sc
      .from('purchase_orders')
      .select('id, po_number, status, vendor_id, delivery_location_id, created_by_user_id, approved_by_user_id')
      .eq('id', body.existing_po_id)
      .eq('tenant_id', ctx.tenantId!)
      .limit(1)
      .single();

    if (existingPOError || !existingPO) {
      throw AppError.notFound('Existing purchase order not found.');
    }

    if (existingPO.status === 'awaiting_approval') {
      throw AppError.forbidden(
        'This PO is waiting on manager approval — the order goes to Amazon once it’s approved.'
      );
    }

    // The Amazon approval gate (Grant, 2026-08-04): the cart's REAL total is
    // only known here, between cart-return and submit — so this is where the
    // spend-limit check runs for punchout. A manager's prior approval
    // (approved_by someone other than the buyer) clears the gate.
    const buyerId = existingPO.created_by_user_id || ctx.userId;
    const managerApproved = !!existingPO.approved_by_user_id && existingPO.approved_by_user_id !== buyerId;
    if (!managerApproved && buyerId) {
      const { data: limit } = await sc.rpc('resolve_spend_limit', {
        p_tenant_id: ctx.tenantId,
        p_user_id: buyerId,
        p_vendor_id: existingPO.vendor_id,
        p_initiated_by: 'user',
      });
      if (limit != null && total > Number(limit)) {
        const { data: approver } = await sc.rpc('resolve_po_approver', {
          p_tenant_id: ctx.tenantId,
          p_buyer_user_id: buyerId,
          p_delivery_location_id: existingPO.delivery_location_id,
        });
        await sc
          .from('purchase_orders')
          .update({
            status: 'awaiting_approval',
            approval_reason: `Amazon cart total $${total.toFixed(2)} exceeds spend limit $${Number(limit).toFixed(2)}`,
            approver_user_id: approver ?? null,
            last_event_id: crypto.randomUUID(),
          })
          .eq('id', existingPO.id)
          .eq('tenant_id', ctx.tenantId!);
        log.info('amazon.submit.gated_for_approval', { poId: existingPO.id, total, limit });
        return {
          // Cast: this early-return shape intentionally differs from the
          // submitted-order payload below (union confuses the factory generic).
          data: {
            needs_approval: true,
            po_id: existingPO.id,
            po_number: existingPO.po_number,
            total,
            message: 'Cart total is over your spend limit — sent to your manager for approval. Submit again once approved.',
          } as any,
          status: 200,
          events: [],
        };
      }
    }

    poId = existingPO.id;
    poNumber = existingPO.po_number;
  } else {
    // Create a new internal PO (original flow from widget). NOTE: this route runs
    // on the admin/service-role client with no user JWT, so rpc_create_purchase_order
    // (which derives tenant from auth.jwt() and throws without one) CANNOT be used —
    // it previously threw and was silently swallowed, placing the Amazon order with
    // no internal PO. Use the explicit-tenant rpc_create_po_from_punchout instead.
    const poLines = orderLines.map((line) => ({
      catalog_item_id: null,
      item_description: line.description || line.supplierSku,
      qty_ordered: line.quantity,
      unit_cost: line.unitPrice,
      line_notes: `ASIN: ${line.supplierSku} | SPAID: ${line.spaid}`,
    }));

    const { data: vendor } = await sc
      .from('vendors')
      .select('id')
      .eq('tenant_id', ctx.tenantId!)
      .eq('code', 'AMAZON-BIZ')
      .limit(1)
      .maybeSingle();

    if (vendor) {
      const { data: poResult, error: poError } = await sc.rpc('rpc_create_po_from_punchout', {
        p_tenant_id: ctx.tenantId,
        p_vendor_id: vendor.id,
        p_delivery_location_id: body.location_id || null,
        p_notes: `Amazon Business cXML Order (punchout session ${order.id})`,
        p_lines: poLines,
      });

      if (poError || !poResult?.po_id) {
        log.error('amazon.submit.po_create_failed', { error: poError?.message });
        throw AppError.internal(`Failed to create internal PO: ${poError?.message || 'unknown error'}`);
      }
      poId = poResult.po_id;
      poNumber = poResult.po_number;
    }
  }

  log.info('amazon.order.building', {
    punchoutOrderId: order.id,
    poId,
    poNumber,
    lineCount: orderLines.length,
    total,
  });

  // 7. Build and POST cXML OrderRequest
  const { xml, payloadId } = buildOrderRequest({
    credentials: cxmlConfig,
    orderDate: new Date().toISOString().split('T')[0],
    shipTo,
    items: orderLines,
    total,
    currency: orderLines[0]?.currency || 'USD',
    poReferenceNumber: poNumber || order.id,
    userEmail: order.user_email,
  });

  const response = await postCxml(cxmlConfig.poRequestUrl, xml);
  const parsedResponse = parseOrderResponse(response.body);

  const isSuccess = parsedResponse.statusCode === '200' || parsedResponse.statusCode === '201';

  log.info('amazon.order.response', {
    punchoutOrderId: order.id,
    payloadId,
    statusCode: parsedResponse.statusCode,
    statusText: parsedResponse.statusText,
    httpStatus: response.status,
  });

  // 8. Update punchout order with submission result
  const { error: updateError } = await inv
    .from('punchout_orders')
    .update({
      status: isSuccess ? 'submitted' : 'rejected',
      order_payload_id: payloadId,
      order_submitted_at: new Date().toISOString(),
      order_response_status: parsedResponse.statusCode,
      order_response_raw: response.body,
      purchase_order_id: poId,
      total_cost: total,
      shipping_address: shipTo,
      error_message: isSuccess ? null : parsedResponse.statusText,
    })
    .eq('id', order.id);

  if (updateError) {
    log.warn('amazon.order.update_failed', { orderId: order.id, error: updateError.message });
  }

  // Mark internal PO as ordered if we have one. NOTE: rpc_mark_po_ordered derives
  // the tenant from auth.jwt(), which is NULL under the admin/service-role client
  // used by this route — it would RAISE 'Authentication required' and, because the
  // result was previously ignored, silently leave the PO stuck in 'draft' even
  // though Amazon accepted the order. Update directly with the explicit tenant
  // instead (same reasoning the PO *creation* path uses rpc_create_po_from_punchout).
  let poMarkedOrdered = false;
  if (poId && isSuccess) {
    const nowIso = new Date().toISOString();
    const { error: markError } = await sc
      .from('purchase_orders')
      .update({
        status: 'placed',
        external_order_number: payloadId,
        ordered_at: nowIso,
        ordered_by_user_id: ctx.userId ?? null,
        order_placement_method: 'portal',
        order_placement_notes: `Submitted via Amazon Business cXML punchout. Payload: ${payloadId}`,
        updated_at: nowIso,
      })
      .eq('id', poId)
      .eq('tenant_id', ctx.tenantId!)
      // Only advance from the pre-order buckets — never downgrade a received/closed PO
      // or re-stamp on idempotent replay.
      .in('status', ['draft', 'approved']);
    if (markError) {
      log.error('amazon.order.mark_ordered_failed', { poId, error: markError.message });
    } else {
      poMarkedOrdered = true;
    }
  }

  // 9. Reconcile the PO's lines with what was ACTUALLY ordered. The PO was
  // created with estimated prices (or a preload cart the user then edited on
  // Amazon) — the submitted cart's real prices, pack-rounded quantities, and
  // any items added/removed on Amazon are the truth, so the PO matches it.
  const reconcile = { updated: 0, added: 0, cancelled: 0 };
  if (poId && isSuccess && body.existing_po_id) {
    try {
      const { data: poLines } = await sc
        .from('purchase_order_lines')
        .select('id, line_number, catalog_item_id, qty_ordered, unit_cost, qty_received, status')
        .eq('tenant_id', ctx.tenantId!)
        .eq('po_id', poId)
        .limit(500);

      const unmatchedPoLines = new Map<string, any[]>(); // catalog_item_id -> lines
      for (const pl of poLines || []) {
        if (!pl.catalog_item_id) continue;
        const arr = unmatchedPoLines.get(pl.catalog_item_id) || [];
        arr.push(pl);
        unmatchedPoLines.set(pl.catalog_item_id, arr);
      }
      let maxLineNumber = Math.max(0, ...(poLines || []).map((l: any) => Number(l.line_number) || 0));
      const matchedIds = new Set<string>();

      for (const line of orderLines) {
        const catalogItemId = asinToCatalogItem.get(line.supplierSku);
        const candidates = catalogItemId ? unmatchedPoLines.get(catalogItemId) : undefined;
        const poLine = candidates?.shift();
        if (poLine) {
          matchedIds.add(poLine.id);
          if (Number(poLine.qty_ordered) !== line.quantity || Number(poLine.unit_cost) !== line.unitPrice) {
            const { error: lineError } = await sc
              .from('purchase_order_lines')
              .update({
                qty_ordered: line.quantity,
                unit_cost: line.unitPrice,
                price_basis: 'fixed',
                last_event_id: crypto.randomUUID(),
              })
              .eq('id', poLine.id)
              .eq('tenant_id', ctx.tenantId!);
            if (!lineError) reconcile.updated += 1;
          } else {
            // Matched and already accurate — nothing to write.
          }
        } else {
          // Added on Amazon — appears on the PO as a new line. Non-catalog
          // lines need a UOM; resolve EA (each) from GV, and skip (log) if
          // that fails rather than failing an already-placed order.
          let uomTermId: string | null = null;
          if (!catalogItemId) {
            try {
              const { getGVClient } = await import('@/lib/gv');
              uomTermId = await getGVClient().resolveTermId(ctx.tenantId!, 'uom', 'EA', false);
            } catch { /* logged below when null */ }
            if (!uomTermId) {
              log.warn('amazon.reconcile.skip_unmapped_line', { poId, asin: line.supplierSku });
              continue;
            }
          }
          maxLineNumber += 1;
          const { error: insertError } = await sc.from('purchase_order_lines').upsert({
            tenant_id: ctx.tenantId!,
            po_id: poId,
            line_number: maxLineNumber,
            catalog_item_id: catalogItemId ?? null,
            item_description: line.description || line.supplierSku,
            uom_term_id: catalogItemId ? null : uomTermId,
            qty_ordered: line.quantity,
            unit_cost: line.unitPrice,
            price_basis: 'fixed',
            status: 'pending',
            line_notes: `Added on Amazon | ASIN: ${line.supplierSku} | SPAID: ${line.spaid}`,
            last_event_id: crypto.randomUUID(),
          });
          if (!insertError) reconcile.added += 1;
          else log.warn('amazon.reconcile.add_line_failed', { poId, asin: line.supplierSku, error: insertError.message });
        }
      }

      // Lines the user dropped on Amazon: cancel (never touch received lines).
      for (const pl of poLines || []) {
        if (matchedIds.has(pl.id) || Number(pl.qty_received) > 0) continue;
        if (['cancelled', 'fully_received', 'partially_received'].includes(pl.status)) continue;
        const { error: cancelError } = await sc
          .from('purchase_order_lines')
          .update({ status: 'cancelled', last_event_id: crypto.randomUUID() })
          .eq('id', pl.id)
          .eq('tenant_id', ctx.tenantId!)
          .eq('qty_received', 0);
        if (!cancelError) reconcile.cancelled += 1;
      }

      log.info('amazon.reconcile.done', { poId, ...reconcile });
    } catch (err: any) {
      // Reconciliation is best-effort — the Amazon order is already placed.
      log.warn('amazon.reconcile.failed', { poId, error: err?.message });
    }
  }

  if (!isSuccess) {
    throw AppError.internal(
      `Amazon rejected the order: ${parsedResponse.statusText} (code ${parsedResponse.statusCode})`
    );
  }

  return {
    data: {
      punchout_order_id: order.id,
      status: 'submitted',
      order_payload_id: payloadId,
      po_id: poId,
      po_number: poNumber,
      total,
      items_count: orderLines.length,
      // How many PO lines were re-priced/added/cancelled to match the cart.
      lines_reconciled: reconcile,
      amazon_response: {
        status_code: parsedResponse.statusCode,
        status_text: parsedResponse.statusText,
      },
      // The Amazon order itself succeeded, but surfacing a failed PO-status
      // update lets the user verify instead of trusting a stale 'draft' row.
      warning: poId && !poMarkedOrdered
        ? 'Order placed with Amazon, but the PO status could not be updated — refresh and verify.'
        : null,
    },
    status: 200,
    events: [
      {
        event_name: 'punchout.submitted',
        payload: {
          punchout_order_id: order.id,
          po_id: poId,
          po_number: poNumber,
          total,
          provider: 'amazon-business',
        },
        last_event_id: idempotencyKey,
      },
      // Mirror the event rpc_mark_po_ordered used to emit, but only when the PO
      // actually advanced to 'placed' here.
      ...(poMarkedOrdered
        ? [{
            event_name: 'purchase_order.ordered_externally',
            payload: {
              po_id: poId,
              po_number: poNumber,
              external_order_number: payloadId,
              order_placement_method: 'portal',
              provider: 'amazon-business',
            },
            last_event_id: `${idempotencyKey}-ordered`,
          }]
        : []),
    ],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/settings/integrations/amazon-business/punchout/submit' });
