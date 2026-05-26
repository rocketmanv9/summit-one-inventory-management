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
} from '@/lib/integrations/amazon-cxml';

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
    return htmlPage(
      'Session not found',
      'This punchout session has expired. Please close this tab and start a new order.',
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
