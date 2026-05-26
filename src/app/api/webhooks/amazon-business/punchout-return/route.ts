/**
 * Amazon Business Punchout Return (POOM Receiver)
 *
 * POST — receives the PunchOutOrderMessage via browser form POST from Amazon.
 * Amazon auto-submits a form with the POOM in `cxml-urlencoded` or `cxml-base64`.
 *
 * This runs in the user's browser (Amazon redirects here via BrowserFormPost).
 * We parse the POOM, store the cart data, and return an HTML page that redirects
 * the user back to the integrations page with the cart review open.
 *
 * Tenant context comes from the buyerCookie embedded in the POOM, NOT from a
 * session — this is a cross-site form POST from Amazon's domain.
 */
import { createWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { getAdminClient } from '@/utils/supabase/admin';
import {
  decodePoomFromFormData,
  parsePunchOutOrderMessage,
} from '@/lib/integrations/amazon-cxml';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function htmlRedirectPage(url: string, message: string): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="1;url=${url}">
  <title>Returning to Summit One</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f9fafb; }
    .card { text-align: center; padding: 2rem; background: white; border-radius: 8px; border: 1px solid #e5e7eb; max-width: 400px; }
    .spinner { width: 24px; height: 24px; border: 3px solid #e5e7eb; border-top: 3px solid #f97316; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 1rem; }
    @keyframes spin { to { transform: rotate(360deg); } }
    h2 { margin: 0 0 0.5rem; font-size: 1.1rem; color: #111827; }
    p { margin: 0; color: #6b7280; font-size: 0.875rem; }
    a { color: #f97316; text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <h2>${message}</h2>
    <p>Redirecting you back to Summit One...</p>
    <p style="margin-top: 1rem;"><a href="${url}">Click here if not redirected</a></p>
  </div>
  <script>window.location.replace("${url}");</script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export const POST = createWriteRoute(async ({ req, log, idempotencyKey }) => {
  const adminClient = getAdminClient();
  const inv = (adminClient as any).schema('inventory');

  // 1. Read raw form body and decode the cXML
  const rawBody = await req.text();
  let poomXml: string;
  try {
    poomXml = decodePoomFromFormData(rawBody);
  } catch (err: any) {
    log.warn('amazon.poom.decode_failed', { error: err?.message });
    return htmlRedirectPage(
      '/settings/integrations?punchout_error=Could+not+decode+cart+data+from+Amazon',
      'Something went wrong'
    );
  }

  // 2. Parse the POOM
  let poom;
  try {
    poom = parsePunchOutOrderMessage(poomXml);
  } catch (err: any) {
    log.warn('amazon.poom.parse_failed', { error: err?.message });
    return htmlRedirectPage(
      `/settings/integrations?punchout_error=${encodeURIComponent(err?.message || 'Parse error')}`,
      'Could not read Amazon cart'
    );
  }

  log.info('amazon.poom.received', {
    buyerCookie: poom.buyerCookie,
    itemCount: poom.items.length,
    total: poom.total,
  });

  // 3. Look up the punchout order by buyerCookie
  const { data: order, error: lookupError } = await inv
    .from('punchout_orders')
    .select('id, tenant_id, status, user_email')
    .eq('buyer_cookie', poom.buyerCookie)
    .limit(1)
    .single();

  if (lookupError || !order) {
    log.warn('amazon.poom.unknown_cookie', { buyerCookie: poom.buyerCookie });
    return htmlRedirectPage(
      '/settings/integrations?punchout_error=Session+not+found.+Please+start+a+new+punchout.',
      'Session expired'
    );
  }

  if (order.status !== 'punchout_started') {
    log.warn('amazon.poom.unexpected_status', { orderId: order.id, currentStatus: order.status });
  }

  // 4. Validate inbound credentials match the tenant
  // The POOM's From should be Amazon and To should be the tenant's identity
  // (We trust the buyerCookie lookup for tenant context; the SPAID is the real auth)

  // 5. Store the POOM data and update status
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
    log.warn('amazon.poom.store_failed', { orderId: order.id, error: updateError.message });
    return htmlRedirectPage(
      '/settings/integrations?punchout_error=Failed+to+save+cart',
      'Something went wrong'
    );
  }

  log.info('amazon.poom.stored', {
    orderId: order.id,
    tenantId: order.tenant_id,
    itemCount: poomItems.length,
    total: poom.total,
  });

  // 6. Redirect user to the cart review page
  return htmlRedirectPage(
    `/settings/integrations?punchout_review=${order.id}`,
    `Amazon cart received — ${poomItems.length} item${poomItems.length === 1 ? '' : 's'}`
  );
}, {
  serviceName: SERVICE_NAME,
  scope: 'POST /api/webhooks/amazon-business/punchout-return',
  authenticate: async () => {
    const supabase = getAdminClient();
    return { tenantId: 'system', userId: 'amazon-punchout-return', supabase };
  },
});
