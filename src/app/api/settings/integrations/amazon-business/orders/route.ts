/**
 * Amazon Business Order Placement API
 * POST — create PO + place Amazon Business order for mapped catalog items
 * GET  — list Amazon Business orders for tenant
 */
import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { getAdminClient } from '@/utils/supabase/admin';
import {
  resolveAmazonBusinessConfig,
  createCart,
  addCartItems,
  getCostEstimate,
  placeOrder,
  type AmazonShippingAddress,
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

/**
 * Ensure an "Amazon Business" vendor exists in supply_chain.vendors.
 * The PO system requires a vendor_id, so we upsert a vendor for Amazon.
 */
async function ensureAmazonVendor(adminClient: any, tenantId: string, idempotencyKey: string): Promise<string> {
  const sc = (adminClient as any).schema('supply_chain');

  // Check if vendor already exists
  const { data: existing } = await sc
    .from('vendors')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('code', 'AMAZON-BIZ')
    .limit(1)
    .maybeSingle();

  if (existing) return existing.id;

  // Create vendor
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

// ── POST: Create PO + Place Amazon Business order ───────────────────────

export const POST = createSessionWriteRoute(async ({ req, ctx, log, idempotencyKey }) => {
  const body = PlaceOrderSchema.parse(await req.json());
  const adminClient = getAdminClient();

  // 1. Resolve Amazon Business config (secrets from Vault)
  const config = await resolveAmazonBusinessConfig(adminClient, ctx.tenantId!);
  const prov = (adminClient as any).schema('provisioning');
  const inv = (adminClient as any).schema('inventory');
  const sc = (adminClient as any).schema('supply_chain');

  // 2. Resolve ASIN mappings for all items (with metadata for pack_size/units)
  const catalogItemIds = body.items.map((i) => i.catalog_item_id);

  const { data: mappings, error: mappingError } = await prov
    .from('provider_item_mappings')
    .select('catalog_item_id, external_product_id, unit_cost, metadata')
    .eq('tenant_id', ctx.tenantId!)
    .eq('provider_id', config.providerId)
    .in('catalog_item_id', catalogItemIds)
    .limit(100);

  if (mappingError) throw AppError.internal(mappingError.message);

  const mappingMap = new Map<string, { asin: string; unit_cost: number | null; metadata: any }>(
    (mappings || []).map((m: any) => [m.catalog_item_id, {
      asin: m.external_product_id,
      unit_cost: m.unit_cost,
      metadata: m.metadata,
    }])
  );

  // Check all items have ASIN mappings
  const unmapped = body.items.filter((i) => !mappingMap.has(i.catalog_item_id));
  if (unmapped.length > 0) {
    throw AppError.badRequest(
      `No Amazon ASIN mapping for catalog items: ${unmapped.map((i) => i.catalog_item_id).join(', ')}. Add mappings in Settings > Integrations.`
    );
  }

  // 3. Load delivery location and require structured address fields
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
      'Update the location in Inventory > Locations before placing an Amazon order.'
    );
  }

  const shippingAddress: AmazonShippingAddress = {
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

  // 5. Create PO via RPC
  const poLines = body.items.map((item, idx) => {
    const mapping = mappingMap.get(item.catalog_item_id)!;
    return {
      catalog_item_id: item.catalog_item_id,
      qty_ordered: item.qty,
      unit_cost: mapping.unit_cost ?? null,
      estimated_unit_cost: mapping.unit_cost ?? null,
      price_basis: mapping.unit_cost ? 'estimated' : 'unknown',
      line_notes: `ASIN: ${mapping.asin}`,
    };
  });

  const { data: poResult, error: poError } = await sc.rpc('rpc_create_purchase_order', {
    p_vendor_id: vendorId,
    p_po_number: null, // auto-generate
    p_delivery_method: 'ship',
    p_needed_by_date: null,
    p_cost_context: 'yard',
    p_job_id: null,
    p_delivery_location_id: body.location_id,
    p_pickup_location_id: null,
    p_max_authorized_spend: null,
    p_vendor_quote_ref: null,
    p_notes: body.label || 'Amazon Business order',
    p_attachments: [],
    p_lines: poLines,
  });

  if (poError) throw AppError.internal(`Failed to create PO: ${poError.message}`);

  const poId = poResult?.po_id;
  const poNumber = poResult?.po_number;

  if (!poId) throw AppError.internal('PO creation returned no ID');

  log.info('amazon.po.created', { poId, poNumber, lineCount: poLines.length });

  // 6. Place Amazon order via API
  const cartItems = body.items.map((item) => ({
    asin: mappingMap.get(item.catalog_item_id)!.asin,
    quantity: item.qty,
  }));

  const cartId = await createCart(config);
  await addCartItems(config, cartId, cartItems);

  let costEstimate;
  try {
    costEstimate = await getCostEstimate(config, cartId, shippingAddress);
  } catch (err) {
    log.warn('amazon.cost_estimate_failed', { cartId, error: String(err) });
  }

  const orderResult = await placeOrder(config, cartId, shippingAddress, idempotencyKey);

  log.info('amazon.order.placed', {
    amazonOrderId: orderResult.orderId,
    poId,
    poNumber,
    cartId,
    itemCount: cartItems.length,
  });

  // 7. Mark PO as ordered with external order number
  await sc.rpc('rpc_mark_po_ordered', {
    p_po_id: poId,
    p_external_order_number: orderResult.orderId,
    p_order_placement_method: 'portal',
    p_order_placement_notes: `Placed via Amazon Business API. Cart ID: ${cartId}`,
  });

  // 8. Insert tracking record in amazon_business_orders
  const { data: orderRecord, error: insertError } = await inv
    .from('amazon_business_orders')
    .upsert({
      tenant_id: ctx.tenantId!,
      amazon_order_id: orderResult.orderId,
      amazon_cart_id: cartId,
      provider_id: config.providerId,
      purchase_order_id: poId,
      status: 'submitted',
      items: body.items.map((item) => ({
        catalog_item_id: item.catalog_item_id,
        qty: item.qty,
        asin: mappingMap.get(item.catalog_item_id)!.asin,
      })),
      shipping_address: shippingAddress,
      cost_estimate: costEstimate || null,
      total_cost: costEstimate?.total ?? null,
    }, { onConflict: 'amazon_order_id' })
    .select()
    .single();

  if (insertError) {
    log.warn('amazon.order.track_failed', { amazonOrderId: orderResult.orderId, error: insertError.message });
  }

  return {
    data: {
      order_id: orderRecord?.id ?? null,
      amazon_order_id: orderResult.orderId,
      po_id: poId,
      po_number: poNumber,
      cart_id: cartId,
      status: 'submitted',
      items_count: cartItems.length,
      cost_estimate: costEstimate || null,
    },
    status: 201,
    events: [{
      event_name: 'purchase_order.ordered',
      payload: {
        po_id: poId,
        po_number: poNumber,
        amazon_order_id: orderResult.orderId,
        provider: 'amazon-business',
        items_count: cartItems.length,
        total: costEstimate?.total ?? null,
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
    .select('id, amazon_order_id, amazon_cart_id, purchase_order_id, status, items, total_cost, tracking_info, created_at, updated_at')
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
