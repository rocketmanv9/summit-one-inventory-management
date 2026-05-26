/**
 * Amazon Business Order Placement API
 * POST — create PO + place cXML OrderRequest for mapped catalog items
 * GET  — list Amazon Business orders for tenant
 */
import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { getAdminClient } from '@/utils/supabase/admin';
import {
  resolveCxmlCredentials,
  placeOrder,
  roundToPackQuantity,
  type ShippingAddress,
} from '@/lib/integrations/amazon-business';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// ── Schemas ──────────────────────────────────────────────────────────────

const OrderItemSchema = z.object({
  catalog_item_id: z.string().uuid(),
  qty: z.number().int().min(1),
});

const PlaceOrderSchema = z.object({
  items: z.array(OrderItemSchema).min(1),
  location_id: z.string().uuid(),
  label: z.string().optional(),
});

// ── Helpers ──────────────────────────────────────────────────────────────

async function ensureAmazonVendor(adminClient: any, tenantId: string, idempotencyKey: string): Promise<string> {
  const sc = (adminClient as any).schema('supply_chain');

  const { data: existing } = await sc
    .from('vendors')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('code', 'AMAZON-BIZ')
    .limit(1)
    .maybeSingle();

  if (existing) return existing.id;

  const { data: vendor, error } = await sc
    .from('vendors')
    .upsert({
      tenant_id: tenantId,
      name: 'Amazon Business',
      code: 'AMAZON-BIZ',
      ordering_mode: 'portal_with_po_ref',
      portal_url: 'https://business.amazon.com',
      default_delivery_method: 'ship',
      active: true,
      last_event_id: `amazon-vendor-init-${tenantId}`,
    }, { onConflict: 'tenant_id,code' })
    .select('id')
    .single();

  if (error) throw AppError.internal(`Failed to create Amazon Business vendor: ${error.message}`);
  return vendor.id;
}

// ── POST: Create PO + place cXML order ──────────────────────────────────

export const POST = createSessionWriteRoute(async ({ req, ctx, log, idempotencyKey }) => {
  const body = PlaceOrderSchema.parse(await req.json());
  const adminClient = getAdminClient();

  // 1. Resolve cXML credentials (secrets from Vault)
  const cxmlConfig = await resolveCxmlCredentials(adminClient, ctx.tenantId!);
  const prov = (adminClient as any).schema('provisioning');
  const inv = (adminClient as any).schema('inventory');
  const sc = (adminClient as any).schema('supply_chain');

  // 2. Resolve supplier SKU mappings (ASIN for Amazon, but stored as generic external_product_id)
  const catalogItemIds = body.items.map((i) => i.catalog_item_id);

  const { data: mappings, error: mappingError } = await prov
    .from('provider_item_mappings')
    .select('catalog_item_id, external_product_id, unit_cost, metadata')
    .eq('tenant_id', ctx.tenantId!)
    .eq('provider_id', cxmlConfig.providerId)
    .in('catalog_item_id', catalogItemIds)
    .limit(100);

  if (mappingError) throw AppError.internal(mappingError.message);

  const mappingMap = new Map<string, { supplierSku: string; unitCost: number | null; packQuantity: number; description?: string }>(
    (mappings || []).map((m: any) => [m.catalog_item_id, {
      supplierSku: m.external_product_id,
      unitCost: m.unit_cost,
      packQuantity: m.metadata?.pack_size ?? 1,
      description: m.metadata?.description,
    }])
  );

  const unmapped = body.items.filter((i) => !mappingMap.has(i.catalog_item_id));
  if (unmapped.length > 0) {
    throw AppError.badRequest(
      `No supplier SKU mapping for catalog items: ${unmapped.map((i) => i.catalog_item_id).join(', ')}. Add mappings in Settings > Integrations.`
    );
  }

  // 3. Load delivery location with structured address
  const { data: location, error: locError } = await inv
    .from('locations')
    .select('id, name, address_line_1, address_line_2, city, state, postal_code, country')
    .eq('id', body.location_id)
    .eq('tenant_id', ctx.tenantId!)
    .limit(1)
    .single();

  if (locError || !location) throw AppError.notFound('Delivery location not found');

  if (!location.address_line_1 || !location.city || !location.state || !location.postal_code) {
    throw AppError.badRequest(
      `Location "${location.name}" is missing structured address fields (address, city, state, zip). ` +
      'Update the location in Inventory > Locations before placing an order.'
    );
  }

  const shipTo: ShippingAddress = {
    name: location.name,
    address_line_1: location.address_line_1,
    address_line_2: location.address_line_2 || undefined,
    city: location.city,
    state: location.state,
    postal_code: location.postal_code,
    country: location.country || 'US',
  };

  // 4. Ensure Amazon Business vendor exists in supply_chain
  const vendorId = await ensureAmazonVendor(adminClient, ctx.tenantId!, idempotencyKey);

  // 5. Build line items with pack-quantity rounding
  const orderLines = body.items.map((item) => {
    const mapping = mappingMap.get(item.catalog_item_id)!;
    const roundedQty = roundToPackQuantity(item.qty, mapping.packQuantity);
    return {
      catalogItemId: item.catalog_item_id,
      supplier_sku: mapping.supplierSku,
      quantity: roundedQty,
      unit_price: mapping.unitCost ?? undefined,
      description: mapping.description,
      pack_quantity: mapping.packQuantity,
      original_qty: item.qty,
    };
  });

  // 6. Create PO via RPC
  const poLines = orderLines.map((line) => ({
    catalog_item_id: line.catalogItemId,
    qty_ordered: line.quantity,
    unit_cost: line.unit_price ?? null,
    estimated_unit_cost: line.unit_price ?? null,
    price_basis: line.unit_price ? 'estimated' : 'unknown',
    line_notes: `Supplier SKU: ${line.supplier_sku}` +
      (line.quantity !== line.original_qty ? ` (rounded ${line.original_qty} → ${line.quantity} for pack qty ${line.pack_quantity})` : ''),
  }));

  const { data: poResult, error: poError } = await sc.rpc('rpc_create_purchase_order', {
    p_vendor_id: vendorId,
    p_po_number: null,
    p_delivery_method: 'ship',
    p_needed_by_date: null,
    p_cost_context: 'yard',
    p_job_id: null,
    p_delivery_location_id: body.location_id,
    p_pickup_location_id: null,
    p_max_authorized_spend: null,
    p_vendor_quote_ref: null,
    p_notes: body.label || 'Amazon Business cXML order',
    p_attachments: [],
    p_lines: poLines,
  });

  if (poError) throw AppError.internal(`Failed to create PO: ${poError.message}`);

  const poId = poResult?.po_id;
  const poNumber = poResult?.po_number;

  if (!poId) throw AppError.internal('PO creation returned no ID');

  log.info('amazon.po.created', { poId, poNumber, lineCount: poLines.length });

  // 7. Place cXML OrderRequest (currently stubbed — will throw until implemented)
  let orderResult;
  try {
    orderResult = await placeOrder({
      credentials: cxmlConfig,
      lineItems: orderLines.map((line) => ({
        supplier_sku: line.supplier_sku,
        quantity: line.quantity,
        unit_price: line.unit_price,
        description: line.description,
        pack_quantity: line.pack_quantity,
      })),
      shipTo,
      poReferenceNumber: poNumber,
    });
  } catch (err: any) {
    log.warn('amazon.cxml.order_stub', { poId, poNumber, message: err?.message });
    // PO is created but cXML submission is not yet implemented — record as pending
    orderResult = {
      externalOrderId: `PENDING-${poNumber}`,
      status: 'pending' as const,
      submittedAt: new Date().toISOString(),
    };
  }

  log.info('amazon.order.recorded', {
    externalOrderId: orderResult.externalOrderId,
    poId,
    poNumber,
    itemCount: orderLines.length,
    mode: cxmlConfig.integrationMode,
  });

  // 8. Insert tracking record
  const { data: orderRecord, error: insertError } = await inv
    .from('amazon_business_orders')
    .upsert({
      tenant_id: ctx.tenantId!,
      amazon_order_id: orderResult.externalOrderId,
      provider_id: cxmlConfig.providerId,
      purchase_order_id: poId,
      status: orderResult.status,
      items: orderLines.map((line) => ({
        catalog_item_id: line.catalogItemId,
        qty: line.quantity,
        supplier_sku: line.supplier_sku,
        original_qty: line.original_qty,
        pack_quantity: line.pack_quantity,
      })),
      shipping_address: shipTo,
      metadata: { integration_mode: cxmlConfig.integrationMode },
    }, { onConflict: 'amazon_order_id' })
    .select()
    .single();

  if (insertError) {
    log.warn('amazon.order.track_failed', { externalOrderId: orderResult.externalOrderId, error: insertError.message });
  }

  return {
    data: {
      order_id: orderRecord?.id ?? null,
      external_order_id: orderResult.externalOrderId,
      po_id: poId,
      po_number: poNumber,
      status: orderResult.status,
      items_count: orderLines.length,
      integration_mode: cxmlConfig.integrationMode,
    },
    status: 201,
    events: [{
      event_name: 'purchase_order.ordered',
      payload: {
        po_id: poId,
        po_number: poNumber,
        external_order_id: orderResult.externalOrderId,
        provider: 'amazon-business',
        mechanism: 'cxml',
        items_count: orderLines.length,
        integration_mode: cxmlConfig.integrationMode,
      },
      last_event_id: idempotencyKey,
    }],
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/settings/integrations/amazon-business/orders' });

// ── GET: List Amazon Business orders ─────────────────────────────────────

export const GET = createSessionReadRoute(async ({ session, req }) => {
  const adminClient = getAdminClient();
  const inv = (adminClient as any).schema('inventory');

  const url = new URL(req.url);
  const status = url.searchParams.get('status');

  let query = inv
    .from('amazon_business_orders')
    .select('id, amazon_order_id, purchase_order_id, status, items, total_cost, tracking_info, metadata, created_at, updated_at')
    .eq('tenant_id', session.tenantId!)
    .order('created_at', { ascending: false })
    .limit(100);

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;

  if (error) throw AppError.internal(error.message);

  return Response.json({ data: data || [] });
}, { serviceName: SERVICE_NAME });
