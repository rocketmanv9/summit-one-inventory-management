/**
 * Amazon Business Punchout Return (POOM Receiver)
 *
 * POST — receives the PunchOutOrderMessage via browser form POST from Amazon.
 * Amazon auto-submits a form with the POOM in `cxml-urlencoded` or `cxml-base64`.
 *
 * This runs in the browser tab that was opened for the punchout session.
 * We parse the POOM, store the cart data, and return a minimal HTML page
 * telling the user to return to the main Summit One tab. The main tab
 * polls for cart_returned status and shows the review UI automatically.
 *
 * Tenant context comes from the buyerCookie embedded in the POOM.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/utils/supabase/admin';
import {
  decodePoomFromFormData,
  parsePunchOutOrderMessage,
  extractPoomBuyerContext,
  type ParsedPoom,
} from '@/lib/integrations/amazon-cxml';

/**
 * Resolves which tenant an Amazon-initiated cart belongs to by matching the
 * POOM's buyer NetworkId identity against each active Amazon Business provider's
 * stored from-identity. Falls back to the only active provider if exactly one
 * exists (single-tenant deployments). Returns null if it can't be determined.
 */
async function resolveTenantFromPoom(
  adminClient: any,
  identities: string[]
): Promise<{ tenantId: string } | null> {
  const prov = adminClient.schema('provisioning');
  const { data: providers } = await prov
    .from('providers')
    .select('tenant_id, config, is_active')
    .eq('provider_type', 'procurement_marketplace')
    .like('provider_key', 'amazon-business%')
    .eq('is_active', true)
    .limit(50);

  if (!providers || providers.length === 0) return null;

  const wanted = new Set(identities.map((i) => i.toLowerCase()));
  for (const p of providers) {
    const ref = p.config?.from_identity_ref;
    if (!ref) continue;
    const { data: secret } = await adminClient
      .from('decrypted_secrets')
      .select('decrypted_secret')
      .eq('name', ref)
      .limit(1)
      .single();
    const identity = secret?.decrypted_secret?.trim().toLowerCase();
    if (identity && wanted.has(identity)) return { tenantId: p.tenant_id };
  }

  // Single-tenant fallback: only one Amazon Business provider configured.
  if (providers.length === 1) return { tenantId: providers[0].tenant_id };
  return null;
}

/**
 * Captures an Amazon-initiated cart (no app session matched the buyer_cookie):
 * resolves the tenant, reverse-maps ASINs to catalog items, creates a DRAFT
 * purchase order, and records a punchout order linked to it. Returns the new PO
 * number, or null if it couldn't be routed/created.
 */
async function captureAmazonInitiatedCart(
  adminClient: any,
  poom: ParsedPoom,
  poomXml: string
): Promise<{ poNumber: string; itemCount: number } | null> {
  const { identities, userEmail } = extractPoomBuyerContext(poomXml);
  const resolved = await resolveTenantFromPoom(adminClient, identities);
  if (!resolved) return null;
  const tenantId = resolved.tenantId;

  const sc = adminClient.schema('supply_chain');
  const inv = adminClient.schema('inventory');

  const { data: vendor } = await sc
    .from('vendors')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('code', 'AMAZON-BIZ')
    .eq('active', true)
    .limit(1)
    .maybeSingle();
  if (!vendor) return null;

  // Reverse-map returned ASINs to catalog items (unmapped items keep a null
  // catalog_item_id and just carry the Amazon description).
  const asins = [...new Set(poom.items.map((i) => i.supplierPartId).filter(Boolean))];
  const { data: vendorItems } = asins.length
    ? await sc
        .from('vendor_items')
        .select('catalog_item_id, vendor_sku')
        .eq('tenant_id', tenantId)
        .eq('vendor_id', vendor.id)
        .in('vendor_sku', asins)
        .limit(200)
    : { data: [] as any[] };
  const asinToItem = new Map<string, string>(
    (vendorItems || []).map((vi: any) => [vi.vendor_sku, vi.catalog_item_id])
  );

  const lines = poom.items.map((item) => ({
    catalog_item_id: asinToItem.get(item.supplierPartId) || '',
    item_description: item.description || item.supplierPartId,
    qty_ordered: item.quantity,
    unit_cost: item.unitPrice,
    line_notes: `Amazon ASIN ${item.supplierPartId}`,
  }));

  // Default ship-to location (PO is a draft; the user can change it on review).
  const { data: loc } = await inv
    .from('locations')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('is_default_ship_to', true)
    .limit(1)
    .maybeSingle();

  const { data: poResult, error: poError } = await sc.rpc('rpc_create_po_from_punchout', {
    p_tenant_id: tenantId,
    p_vendor_id: vendor.id,
    p_delivery_location_id: loc?.id || null,
    p_notes: 'Created from an Amazon Business punchout cart (started on Amazon).',
    p_lines: lines,
  });
  if (poError || !poResult?.po_id) return null;

  // Record the punchout order, linked to the draft PO. buyer_cookie is unique;
  // if Amazon re-posts the same cart we skip (the matched path handles re-posts).
  await inv.from('punchout_orders').upsert(
    {
      tenant_id: tenantId,
      setup_payload_id: `amazon-initiated:${poom.buyerCookie}`,
      buyer_cookie: poom.buyerCookie,
      user_email: userEmail || 'amazon-business@punchout',
      status: 'cart_returned',
      poom_received_at: new Date().toISOString(),
      poom_raw: poomXml,
      poom_items: poom.items,
      poom_total: poom.total,
      items: poom.items,
      total_cost: poom.total,
      purchase_order_id: poResult.po_id,
      metadata: { source: 'amazon_initiated', po_number: poResult.po_number },
    },
    { onConflict: 'buyer_cookie' }
  );

  return { poNumber: poResult.po_number, itemCount: poom.items.length };
}

function htmlPage(title: string, message: string, success: boolean): NextResponse {
  const color = success ? '#16a34a' : '#dc2626';
  const bg = success ? '#f0fdf4' : '#fef2f2';
  const borderColor = success ? '#bbf7d0' : '#fecaca';
  const icon = success ? '&#10003;' : '&#10007;';

  return new NextResponse(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f9fafb}
    .card{text-align:center;padding:2rem;background:${bg};border-radius:8px;border:1px solid ${borderColor};max-width:420px}
    .icon{font-size:2rem;color:${color};margin-bottom:.75rem}
    h2{margin:0 0 .5rem;font-size:1.1rem;color:#111827}
    p{margin:0;color:#6b7280;font-size:.875rem}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h2>${title}</h2>
    <p>${message}</p>
  </div>
</body>
</html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

export async function POST(req: NextRequest) {
  const adminClient = getAdminClient();
  const inv = (adminClient as any).schema('inventory');

  // 1. Read raw form body and decode the cXML
  const rawBody = await req.text();
  let poomXml: string;
  try {
    poomXml = decodePoomFromFormData(rawBody);
  } catch {
    return htmlPage(
      'Something went wrong',
      'Could not decode cart data from Amazon. Please close this tab and try again.',
      false
    );
  }

  // 2. Parse the POOM
  let poom;
  try {
    poom = parsePunchOutOrderMessage(poomXml);
  } catch (err: any) {
    return htmlPage(
      'Could not read Amazon cart',
      `${err?.message || 'Parse error'}. Please close this tab and try again.`,
      false
    );
  }

  // 3. Look up the punchout order by buyerCookie
  const { data: order, error: lookupError } = await inv
    .from('punchout_orders')
    .select('id, tenant_id, status, user_email')
    .eq('buyer_cookie', poom.buyerCookie)
    .limit(1)
    .single();

  if (lookupError || !order) {
    // No app-started session matched this cart → it was started on Amazon.
    // Capture it as a draft PO the user can review/approve in Summit One.
    try {
      const captured = await captureAmazonInitiatedCart(adminClient, poom, poomXml);
      if (captured) {
        return htmlPage(
          `Amazon cart received — draft ${captured.poNumber}`,
          `We created draft purchase order ${captured.poNumber} (${captured.itemCount} item${captured.itemCount === 1 ? '' : 's'}) in Summit One. Close this tab and open Purchasing to review and approve it.`,
          true
        );
      }
    } catch {
      // fall through to the generic message below
    }
    return htmlPage(
      'Cart could not be linked',
      'This Amazon cart was not started from Summit One and we could not match it to your account automatically. Please start the order from a purchase order in Summit One, or contact support.',
      false
    );
  }

  // 4. Store the POOM data and update status
  const poomItems = poom.items.map((item, idx) => ({
    line_number: idx + 1,
    supplier_sku: item.supplierPartId,
    spaid: item.supplierPartAuxiliaryId,
    quantity: item.quantity,
    unit_price: item.unitPrice,
    currency: item.currency,
    description: item.description,
    unit_of_measure: item.unitOfMeasure,
  }));

  const { error: updateError } = await inv
    .from('punchout_orders')
    .update({
      status: 'cart_returned',
      poom_received_at: new Date().toISOString(),
      poom_raw: poomXml,
      poom_items: poomItems,
      poom_total: poom.total,
      items: poomItems,
      total_cost: poom.total,
    })
    .eq('id', order.id);

  if (updateError) {
    return htmlPage(
      'Failed to save cart',
      'An error occurred saving your Amazon cart. Please close this tab and try again.',
      false
    );
  }

  // 5. Return success page — user closes this tab and returns to Summit One
  return htmlPage(
    `Amazon cart received — ${poomItems.length} item${poomItems.length === 1 ? '' : 's'}`,
    'You can close this tab and return to Summit One to review and submit your order.',
    true
  );
}
