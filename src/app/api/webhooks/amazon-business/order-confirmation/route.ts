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

    // 4. Honor the confirmation outcome. A header or all-line "reject" means Amazon
    //    will not fulfill the order — reflect that as cancelled, NOT acknowledged.
    const lineStatuses = (conf.items || []).map((i) => (i.status || '').toLowerCase());
    const isRejected =
      (conf.confirmationType || '').toLowerCase() === 'reject' ||
      (lineStatuses.length > 0 && lineStatuses.every((s) => s === 'reject'));

    // Never overwrite a PO already further along (received) or already final.
    const locked = ['partially_received', 'fully_received', 'closed', 'cancelled', 'voided'];
    if (!locked.includes(po.status)) {
      await sc
        .from('purchase_orders')
        .update({ status: isRejected ? 'cancelled' : 'acknowledged' })
        .eq('id', po.id);
    }

    // 4b. Reconcile PO lines to what Amazon actually confirmed — corrected
    //     quantities (per ConfirmationItem) and a reprice so the line totals sum
    //     to Amazon's authoritative goods <Total> (not our pre-order estimate).
    //     Idempotent: the reprice only runs when totals disagree, so a repeated
    //     confirmation is a no-op.
    if (!isRejected && conf.itemsTotal != null && conf.itemsTotal > 0) {
      const { data: lines } = await sc
        .from('purchase_order_lines')
        .select('id, line_number, qty_ordered, unit_cost, estimated_unit_cost')
        .eq('tenant_id', tenantId)
        .eq('po_id', po.id);

      const rows = (lines ?? []) as any[];
      if (rows.length) {
        const qtyByLine = new Map(
          (conf.items || [])
            .filter((i) => i.lineNumber > 0 && i.quantity > 0)
            .map((i) => [i.lineNumber, i.quantity]),
        );
        for (const ln of rows) {
          const cq = qtyByLine.get(ln.line_number);
          if (cq != null && Number(ln.qty_ordered) !== cq) {
            ln.qty_ordered = cq;
            await sc.from('purchase_order_lines').update({ qty_ordered: cq }).eq('id', ln.id);
          }
        }
        const ext = (l: any) => Number(l.qty_ordered) * Number(l.unit_cost ?? l.estimated_unit_cost ?? 0);
        const current = rows.reduce((s, l) => s + ext(l), 0);
        if (Math.abs(current - conf.itemsTotal) > 0.01) {
          if (current > 0) {
            const scale = conf.itemsTotal / current;
            for (const ln of rows) {
              const base = Number(ln.unit_cost ?? ln.estimated_unit_cost ?? 0);
              await sc.from('purchase_order_lines')
                .update({ unit_cost: Math.round(base * scale * 10000) / 10000 })
                .eq('id', ln.id);
            }
          } else {
            const totalQty = rows.reduce((s, l) => s + Number(l.qty_ordered), 0) || 1;
            const even = Math.round((conf.itemsTotal / totalQty) * 10000) / 10000;
            for (const ln of rows) {
              await sc.from('purchase_order_lines').update({ unit_cost: even }).eq('id', ln.id);
            }
          }
        }
      }
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
              rejected: isRejected,
              amazon_order_id: conf.amazonOrderId,
              items: conf.items,
              items_total: conf.itemsTotal,
              shipping: conf.shipping,
              tax: conf.tax,
              received_at: new Date().toISOString(),
              raw: xml.slice(0, 20000),
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
