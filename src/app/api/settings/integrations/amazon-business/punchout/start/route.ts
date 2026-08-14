/**
 * Start Amazon Business Punchout Session
 * POST — resolve catalog items to ASINs, build PunchOutSetupRequest,
 *        POST to Amazon, return redirect URL for the user.
 *
 * Pre-loads the suggested cart: catalog_item_ids are resolved to ASINs
 * via vendor_items, quantities rounded to pack_quantity multiples.
 * Ship-to comes from the tenant's selected location (per-tenant).
 */
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { getAdminClient } from '@/utils/supabase/admin';
import { resolveCxmlCredentials, roundToPackQuantity } from '@/lib/integrations/amazon-business';
import {
  buildPunchOutSetupRequest,
  parsePunchOutSetupResponse,
  postCxml,
  validateShipToAddress,
  normalizeStateCode,
  normalizeCountryCode,
} from '@/lib/integrations/amazon-cxml';
import { applyInheritedAddress } from '@/lib/locations/resolve-address';
import { assertCanPunchOut } from '@/lib/amazon-access';
import { headers } from 'next/headers';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const StartSchema = z.object({
  user_email: z.string().email(),
  location_id: z.string().uuid(),
  catalog_items: z.array(z.object({
    catalog_item_id: z.string().uuid(),
    // qty_ordered is a Postgres numeric, which PostgREST serializes as a string
    // (e.g. "1.0000"). Coerce so a stringy quantity doesn't 400 the whole request.
    quantity: z.coerce.number().int().min(1),
  })).min(1),
  suggestion_ids: z.array(z.string().uuid()).optional(),
});

export const POST = createSessionWriteRoute(async ({ req, ctx, log, idempotencyKey }) => {
  const body = StartSchema.parse(await req.json());
  const adminClient = getAdminClient();
  const inv = (adminClient as any).schema('inventory');
  const sc = (adminClient as any).schema('supply_chain');

  // Purchaser gate (item 06). Soft by design: if the tenant has no purchaser
  // registry rows at all this is a no-op and the flow behaves exactly as it did
  // before. Once an admin registers purchasers in Settings → Integrations →
  // Amazon, only registered people with can_punch_out may start a session — and
  // the 403 carries copy the UI shows verbatim ("ask an admin to add you").
  const punchOutAccess = await assertCanPunchOut(adminClient, ctx.tenantId!, ctx.userId);

  const cxmlConfig = await resolveCxmlCredentials(adminClient, ctx.tenantId!);

  const punchoutUrl = cxmlConfig.punchoutUrl;
  if (!punchoutUrl) {
    throw AppError.badRequest(
      `No ${cxmlConfig.sandbox ? 'test' : 'live'} Punchout URL configured. Update cXML credentials in Settings > Integrations.`
    );
  }

  // 1. Load the tenant's ship-to location
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

  // Reject incomplete or state/ZIP-mismatched addresses up front — in production
  // Amazon silently blocks checkout for a bad ShipTo, so the cart just never returns.
  validateShipToAddress(eff, location.name);

  // Store and transmit the normalized address (2-letter state, ISO country) so the
  // saved shipping_address matches what we send and isn't a free-text mismatch.
  const shipTo = {
    name: location.name,
    address_line_1: eff.address_line_1,
    address_line_2: eff.address_line_2 || undefined,
    city: eff.city,
    state: normalizeStateCode(eff.state),
    postal_code: eff.postal_code,
    country: normalizeCountryCode(eff.country || 'US'),
    addressId: location.id,
    deliverTo: location.name,
  };

  // 2. Resolve ASINs from vendor_items for the Amazon vendor
  const { data: vendor } = await sc
    .from('vendors')
    .select('id')
    .eq('tenant_id', ctx.tenantId!)
    .eq('code', 'AMAZON-BIZ')
    .eq('active', true)
    .limit(1)
    .maybeSingle();

  if (!vendor) {
    throw AppError.badRequest('Amazon Business vendor not found. Connect Amazon Business first.');
  }

  const catalogItemIds = body.catalog_items.map((i) => i.catalog_item_id);

  const { data: vendorItems } = await sc
    .from('vendor_items')
    .select('catalog_item_id, vendor_sku, pack_size')
    .eq('tenant_id', ctx.tenantId!)
    .eq('vendor_id', vendor.id)
    .eq('active', true)
    .in('catalog_item_id', catalogItemIds)
    .limit(100);

  const asinMap = new Map<string, { asin: string; packQty: number }>(
    (vendorItems || []).map((vi: any) => [vi.catalog_item_id, {
      asin: vi.vendor_sku,
      packQty: Number(vi.pack_size) || 1,
    }])
  );

  const unmapped = body.catalog_items.filter((i) => !asinMap.has(i.catalog_item_id));
  if (unmapped.length > 0) {
    throw AppError.badRequest(
      `No Amazon ASIN mapping for ${unmapped.length} item(s). Add mappings in Settings > Integrations > Amazon Product Mappings.`
    );
  }

  // 3. Build pre-load items with pack-quantity rounding
  const preloadItems = body.catalog_items.map((item) => {
    const mapping = asinMap.get(item.catalog_item_id)!;
    return {
      asin: mapping.asin,
      quantity: roundToPackQuantity(item.quantity, mapping.packQty),
    };
  });

  // 4. Build PunchOutSetupRequest
  const buyerCookie = `summit:${crypto.randomUUID()}`;

  const h = await headers();
  const host = h.get('host')!;
  const proto = h.get('x-forwarded-proto') || 'https';
  // Amazon posts the cart back to this URL from the user's browser as a CROSS-SITE
  // form POST, so Vercel's deployment-protection cookie (SameSite=Lax) isn't sent
  // and the POST gets 401'd before our webhook runs. Carry the protection-bypass
  // secret in the URL (same mechanism the mobile-count QR links use) so Amazon's
  // POST clears protection. Without this the punchout return silently never lands.
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (!bypass) {
    log.warn('amazon.punchout.no_bypass_token', {
      message:
        'punchout return URL has no protection-bypass token; Amazon return POST may be blocked by deployment protection',
    });
  }
  const browserFormPostUrl =
    `${proto}://${host}/api/webhooks/amazon-business/punchout-return` +
    (bypass ? `?x-vercel-protection-bypass=${bypass}&x-vercel-set-bypass-cookie=true` : '');

  const { xml, payloadId } = buildPunchOutSetupRequest({
    credentials: cxmlConfig,
    buyerCookie,
    browserFormPostUrl,
    userEmail: body.user_email,
    shipTo,
    preloadItems,
  });

  log.info('amazon.punchout.setup_request', {
    payloadId,
    punchoutUrl,
    itemCount: preloadItems.length,
    preloadAsins: preloadItems.map((i) => i.asin),
  });

  // 5. POST to Amazon
  const response = await postCxml(punchoutUrl, xml);
  const parsed = parsePunchOutSetupResponse(response.body);

  if (parsed.statusCode !== '200' || !parsed.startPageUrl) {
    log.warn('amazon.punchout.setup_failed', {
      payloadId,
      statusCode: parsed.statusCode,
      statusText: parsed.statusText,
      httpStatus: response.status,
    });
    throw AppError.internal(
      `Amazon PunchOut setup failed: ${parsed.statusText} (code ${parsed.statusCode})`
    );
  }

  // 6. Store punchout order record
  const resolvedItems = body.catalog_items.map((item) => {
    const mapping = asinMap.get(item.catalog_item_id)!;
    return {
      catalog_item_id: item.catalog_item_id,
      supplier_sku: mapping.asin,
      requested_quantity: item.quantity,
      rounded_quantity: roundToPackQuantity(item.quantity, mapping.packQty),
      pack_quantity: mapping.packQty,
    };
  });

  const { data: order, error: insertError } = await inv
    .from('punchout_orders')
    .upsert({
      tenant_id: ctx.tenantId!,
      setup_payload_id: payloadId,
      buyer_cookie: buyerCookie,
      punchout_url: parsed.startPageUrl,
      user_email: body.user_email,
      initiated_by: ctx.userId ?? null,
      status: 'punchout_started',
      items: resolvedItems,
      shipping_address: shipTo,
      metadata: {
        suggestion_ids: body.suggestion_ids ?? [],
        integration_mode: cxmlConfig.integrationMode,
        location_id: body.location_id,
        // Snapshot the registry seat this session ran under, so the PO can name
        // the purchaser later even if the registry row is edited or removed.
        purchaser_amazon_email: punchOutAccess.account?.amazon_email ?? null,
        purchaser_registry_id: punchOutAccess.account?.id ?? null,
      },
    }, { onConflict: 'setup_payload_id' })
    .select()
    .single();

  if (insertError) throw AppError.internal(insertError.message);

  log.info('amazon.punchout.started', {
    orderId: order.id,
    payloadId,
    preloadedItems: preloadItems.length,
  });

  return {
    data: {
      punchout_order_id: order.id,
      redirect_url: parsed.startPageUrl,
      status: 'punchout_started',
      preloaded_items: preloadItems.length,
    },
    status: 201,
    events: [{
      event_name: 'punchout.started',
      payload: {
        punchout_order_id: order.id,
        provider: 'amazon-business',
        items_count: preloadItems.length,
      },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/settings/integrations/amazon-business/punchout/start' });
