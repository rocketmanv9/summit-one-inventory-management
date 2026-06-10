/**
 * Amazon Business Order Confirmation Receiver (inbound cXML ConfirmationRequest)
 *
 * Amazon POSTs a ConfirmationRequest server-to-server once an order is
 * accepted/confirmed. We authenticate via HTTP Basic (credentials defined in
 * Amazon's "Order Confirmation Connection" screen and stored in Vault), match
 * the echoed orderID to our purchase order, mark it acknowledged, and stash the
 * confirmation detail on the linked punchout order.
 *
 * Bare route (not a chassis factory) — same pattern as punchout-return: it
 * consumes raw cXML and must reply with a cXML Response envelope, which the JSON
 * webhook factory can't model. Tenant comes from the Basic-auth credentials.
 */
import { NextRequest } from 'next/server';
import { getAdminClient } from '@/utils/supabase/admin';
import {
  parseBasicAuth,
  resolveTenantFromConfirmationAuth,
  parseConfirmationRequest,
  buildCxmlResponse,
} from '@/lib/integrations/amazon-cxml-inbound';

function cxml(code: number, text: string, httpStatus: number) {
  return new Response(buildCxmlResponse(code, text), {
    status: httpStatus,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  });
}

export async function POST(req: NextRequest) {
  try {
    const adminClient = getAdminClient();

    // 1. Authenticate + resolve tenant from Basic credentials.
    const got = parseBasicAuth(req.headers.get('authorization'));
    const resolved = await resolveTenantFromConfirmationAuth(adminClient, got);
    if (!resolved) return cxml(401, 'Unauthorized', 401);
    const { tenantId } = resolved;

    // 2. Parse the ConfirmationRequest.
    const xml = await req.text();
    const conf = parseConfirmationRequest(xml);
    if (!conf.orderId) return cxml(400, 'Missing orderID', 400);

    const sc = (adminClient as any).schema('supply_chain');
    const inv = (adminClient as any).schema('inventory');

    // 3. Match our PO by the echoed order number (tenant-scoped).
    const { data: po } = await sc
      .from('purchase_orders')
      .select('id, status')
      .eq('tenant_id', tenantId)
      .eq('po_number', conf.orderId)
      .limit(1)
      .maybeSingle();

    if (!po) {
      // 200 so Amazon doesn't retry forever for an order we can't match; the
      // confirmation is informational and our PO state is the source of truth.
      return cxml(200, 'OK (no matching PO)', 200);
    }

    // 4. Advance status to acknowledged, but never downgrade a received/closed PO.
    const terminal = ['partially_received', 'fully_received', 'cancelled', 'voided', 'closed'];
    if (!terminal.includes(po.status)) {
      await sc.from('purchase_orders').update({ status: 'acknowledged' }).eq('id', po.id);
    }

    // 5. Record the confirmation detail on the linked punchout order (if any).
    const { data: order } = await inv
      .from('punchout_orders')
      .select('id, metadata, amazon_order_id')
      .eq('tenant_id', tenantId)
      .eq('purchase_order_id', po.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (order) {
      await inv
        .from('punchout_orders')
        .update({
          amazon_order_id: conf.amazonOrderId ?? order.amazon_order_id ?? null,
          metadata: {
            ...(order.metadata ?? {}),
            order_confirmation: {
              type: conf.confirmationType,
              amazon_order_id: conf.amazonOrderId,
              items: conf.items,
              received_at: new Date().toISOString(),
            },
          },
        })
        .eq('id', order.id);
    }

    return cxml(200, 'OK', 200);
  } catch {
    // Reply 500 in cXML so Amazon retries; never crash to a chrome error page.
    return cxml(500, 'Internal error', 500);
  }
}
