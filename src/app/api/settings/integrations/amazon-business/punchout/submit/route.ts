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
  type OrderRequestLineItem,
} from '@/lib/integrations/amazon-cxml';

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
    .select('id, name, address_line_1, address_line_2, city, state, postal_code, country')
    .eq('id', body.location_id)
    .eq('tenant_id', ctx.tenantId!)
    .limit(1)
    .single();

  if (locError || !location) throw AppError.notFound('Delivery location not found.');

  if (!location.address_line_1 || !location.city || !location.state || !location.postal_code) {
    throw AppError.badRequest(
      `Location "${location.name}" is missing structured address fields.`
    );
  }

  // Amazon rejects non-ISO state/country (error 003-052). The cXML builder
  // normalizes these, but catch an unmappable state here so the operator gets an
  // actionable message instead of a cryptic Amazon rejection.
  const normalizedCountry = normalizeCountryCode(location.country || 'US');
  const normalizedState = normalizeStateCode(location.state);
  if (normalizedCountry === 'US' && !/^[A-Z]{2}$/.test(normalizedState)) {
    throw AppError.badRequest(
      `Location "${location.name}" has an unrecognized state "${location.state}". ` +
      'Enter the 2-letter state code (e.g. GA) so Amazon accepts the shipping address.'
    );
  }

  const shipTo = {
    name: location.name,
    address_line_1: location.address_line_1,
    address_line_2: location.address_line_2 || undefined,
    city: location.city,
    state: normalizedState,
    postal_code: location.postal_code,
    country: normalizedCountry,
  };

  // 4. Optionally resolve pack quantities from vendor_items
  const prov = (adminClient as any).schema('provisioning');
  const asins = poomItems.map((i) => i.supplier_sku);

  const { data: vendorItems } = await sc
    .from('vendor_items')
    .select('vendor_sku, pack_size')
    .eq('tenant_id', ctx.tenantId!)
    .in('vendor_sku', asins)
    .limit(100);

  const packMap = new Map<string, number>(
    (vendorItems || []).map((vi: any) => [vi.vendor_sku, Number(vi.pack_size) || 1])
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
      .select('id, po_number')
      .eq('id', body.existing_po_id)
      .eq('tenant_id', ctx.tenantId!)
      .limit(1)
      .single();

    if (existingPOError || !existingPO) {
      throw AppError.notFound('Existing purchase order not found.');
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
      amazon_response: {
        status_code: parsedResponse.statusCode,
        status_text: parsedResponse.statusText,
      },
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
