/**
 * Amazon Business Ship Notice Receiver (inbound cXML ShipNoticeRequest)
 *
 * Amazon POSTs a ShipNoticeRequest (ASN) server-to-server when a shipment is
 * dispatched, carrying the carrier + tracking number. We authenticate via HTTP
 * Basic (credentials defined in Amazon's "Ship Notification Connection" screen),
 * match the echoed orderID to our purchase order, and store the tracking info on
 * the linked punchout order so it surfaces in Summit One.
 *
 * Bare route (not a chassis factory) — same rationale as order-confirmation.
 */
import { NextRequest } from 'next/server';
import { getAdminClient } from '@/utils/supabase/admin';
import {
  parseBasicAuth,
  resolveTenantFromConfirmationAuth,
  parseShipNoticeRequest,
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

    // 1. Authenticate + resolve tenant (shares the same Basic credentials as
    //    the order-confirmation connection).
    const got = parseBasicAuth(req.headers.get('authorization'));
    const resolved = await resolveTenantFromConfirmationAuth(adminClient, got);
    if (!resolved) return cxml(401, 'Unauthorized', 401);
    const { tenantId } = resolved;

    // 2. Parse the ShipNoticeRequest.
    const xml = await req.text();
    const asn = parseShipNoticeRequest(xml);
    if (!asn.orderId) return cxml(400, 'Missing orderID', 400);

    const sc = (adminClient as any).schema('supply_chain');
    const inv = (adminClient as any).schema('inventory');

    // 3. Match our PO by the echoed order number (tenant-scoped).
    const { data: po } = await sc
      .from('purchase_orders')
      .select('id, status, expected_delivery_date')
      .eq('tenant_id', tenantId)
      .eq('po_number', asn.orderId)
      .limit(1)
      .maybeSingle();

    if (!po) return cxml(200, 'OK (no matching PO)', 200);

    // 4. Fill expected delivery date from the ASN if Amazon provided one and we
    //    don't already have one (date only — column is a DATE).
    if (asn.deliveryDate && !po.expected_delivery_date) {
      const d = asn.deliveryDate.split('T')[0];
      await sc.from('purchase_orders').update({ expected_delivery_date: d }).eq('id', po.id);
    }

    // 4b. Advance the PO to in_transit so the status chip reflects "on its way".
    //     in_transit lives in the "sent" bucket, so receiving stays available.
    //     Never override a terminal/already-received state.
    const locked = ['partially_received', 'fully_received', 'received', 'closed', 'cancelled', 'voided'];
    if (!locked.includes((po.status || '').toLowerCase())) {
      await sc.from('purchase_orders').update({ status: 'in_transit' }).eq('id', po.id);
    }

    // 5. Append the shipment to the linked punchout order's tracking list.
    const { data: order } = await inv
      .from('punchout_orders')
      .select('id, metadata')
      .eq('tenant_id', tenantId)
      .eq('purchase_order_id', po.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (order) {
      const existing = Array.isArray(order.metadata?.shipments) ? order.metadata.shipments : [];
      await inv
        .from('punchout_orders')
        .update({
          metadata: {
            ...(order.metadata ?? {}),
            shipments: [
              ...existing,
              {
                carrier: asn.carrier,
                tracking_number: asn.trackingNumber,
                shipment_id: asn.shipmentId,
                ship_date: asn.shipDate,
                delivery_date: asn.deliveryDate,
                received_at: new Date().toISOString(),
                // Per-line shipped quantities (when the ASN carries item detail).
                // line_number maps to purchase_order_lines.line_number. Stored so
                // the receiving surface can show shipped-vs-ordered per line —
                // this webhook still NEVER posts a receipt.
                ...(asn.items.length > 0
                  ? { lines: asn.items.map((i) => ({ line_number: i.lineNumber, quantity: i.quantity })) }
                  : {}),
              },
            ],
          },
        })
        .eq('id', order.id);
    }

    return cxml(200, 'OK', 200);
  } catch {
    return cxml(500, 'Internal error', 500);
  }
}
