/**
 * GET /api/inventory/purchasing/po-timeline?po_id=<uuid>
 *
 * One unified lifecycle timeline for a purchase order, merging every source into
 * a single time-ordered list: the PO's own milestones (created / approved /
 * sent / ordered), procurement audit events, AI-interpreted vendor activity,
 * carrier shipments + tracking + delivery, goods receipts, and collected
 * documents (receipts / invoices / confirmations / warranties).
 */
import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

type Stage =
  | 'request' | 'order' | 'approval' | 'shipping' | 'tracking' | 'delivery'
  | 'receiving' | 'receipt' | 'invoice' | 'warranty' | 'reconciliation' | 'activity';

interface TimelineEntry {
  id: string;
  stage: Stage;
  title: string;
  detail: string | null;
  at: string | null;
}

const DOC_STAGE: Record<string, Stage> = {
  order_confirmation: 'order', shipping_notification: 'shipping', delivery_confirmation: 'delivery',
  packing_slip: 'receiving', receipt: 'receipt', invoice: 'invoice', credit_memo: 'invoice',
  warranty: 'warranty', other: 'activity',
};

const EVENT_STAGE: Record<string, Stage> = {
  po_created: 'order', po_approved: 'approval', po_cancelled: 'order',
  items_received: 'receiving', invoice_matched: 'reconciliation', payment_made: 'reconciliation',
};

const SUGGESTION_STAGE: Record<string, Stage> = {
  acknowledged: 'order', shipped: 'shipping', delivery_update: 'delivery', delay: 'activity',
  backordered: 'activity', price_change: 'activity', qty_change: 'activity', cancelled: 'order',
  question: 'activity', other: 'activity',
};

export const GET = createSessionReadRoute(
  async ({ req, session }) => {
    const poId = new URL(req.url).searchParams.get('po_id');
    if (!poId) throw AppError.badRequest('po_id is required');
    const tenantId = session.tenantId!;

    const supabase = await createTenantServiceClient({
      url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      tenantId,
    });
    const sc = supabase.schema('supply_chain');

    const [po, events, suggestions, shipments, receipts, documents] = await Promise.all([
      sc.from('purchase_orders')
        .select('created_at, order_date, approved_at, sent_at, ordered_at, external_order_number')
        .eq('id', poId).eq('tenant_id', tenantId).maybeSingle(),
      sc.from('procurement_events')
        .select('id, event_type, occurred_at, payload').eq('po_id', poId).eq('tenant_id', tenantId)
        .order('occurred_at', { ascending: true }).limit(200),
      sc.from('purchase_order_suggestions')
        .select('id, event_type, summary, status, applied_at, created_at')
        .eq('purchase_order_id', poId).eq('tenant_id', tenantId)
        .order('created_at', { ascending: true }).limit(200),
      sc.from('po_shipments')
        .select('id, carrier, tracking_number, ship_date, delivery_date')
        .eq('purchase_order_id', poId).eq('tenant_id', tenantId).limit(100),
      sc.from('receipts')
        .select('id, receipt_number, received_at, vendor_invoice_no, packing_slip_no')
        .eq('po_id', poId).eq('tenant_id', tenantId).order('received_at', { ascending: true }).limit(100),
      sc.from('purchase_documents')
        .select('id, doc_type, file_name, total, invoice_number, match_status, document_date, created_at')
        .eq('purchase_order_id', poId).eq('tenant_id', tenantId)
        .order('created_at', { ascending: true }).limit(200),
    ]);

    const entries: TimelineEntry[] = [];
    const push = (e: TimelineEntry) => { if (e.at) entries.push(e); };

    const p = po.data as any;
    if (p) {
      push({ id: 'po-created', stage: 'request', title: 'Purchase order created', detail: null, at: p.created_at });
      push({ id: 'po-approved', stage: 'approval', title: 'Approved', detail: null, at: p.approved_at });
      push({ id: 'po-sent', stage: 'order', title: 'Sent to vendor', detail: null, at: p.sent_at });
      push({ id: 'po-ordered', stage: 'order', title: 'Order placed', detail: p.external_order_number ? `Vendor order #${p.external_order_number}` : null, at: p.ordered_at });
    }

    for (const e of (events.data as any[]) ?? []) {
      if (e.event_type === 'po_created' || e.event_type === 'po_approved') continue; // covered by milestones
      push({
        id: `evt-${e.id}`, stage: EVENT_STAGE[e.event_type] ?? 'activity',
        title: prettify(e.event_type),
        detail: e.event_type === 'invoice_matched' && e.payload?.after?.total != null
          ? `Reconciled — total $${Number(e.payload.after.total).toFixed(2)}` : null,
        at: e.occurred_at,
      });
    }

    for (const s of (suggestions.data as any[]) ?? []) {
      push({
        id: `sug-${s.id}`, stage: SUGGESTION_STAGE[s.event_type] ?? 'activity',
        title: prettify(s.event_type), detail: s.summary, at: s.applied_at || s.created_at,
      });
    }

    for (const sh of (shipments.data as any[]) ?? []) {
      push({
        id: `ship-${sh.id}`, stage: 'shipping',
        title: sh.carrier ? `Shipped via ${sh.carrier}` : 'Shipped',
        detail: sh.tracking_number ? `Tracking ${sh.tracking_number}` : null, at: sh.ship_date,
      });
      push({ id: `deliv-${sh.id}`, stage: 'delivery', title: 'Delivered', detail: sh.tracking_number ? `Tracking ${sh.tracking_number}` : null, at: sh.delivery_date });
    }

    for (const r of (receipts.data as any[]) ?? []) {
      push({
        id: `rcpt-${r.id}`, stage: 'receiving', title: `Goods received (${r.receipt_number})`,
        detail: r.vendor_invoice_no ? `Vendor invoice ${r.vendor_invoice_no}` : (r.packing_slip_no ? `Packing slip ${r.packing_slip_no}` : null),
        at: r.received_at,
      });
    }

    for (const d of (documents.data as any[]) ?? []) {
      const bits = [d.invoice_number ? `Inv #${d.invoice_number}` : null, d.total != null ? `$${Number(d.total).toFixed(2)}` : null].filter(Boolean);
      push({
        id: `doc-${d.id}`, stage: DOC_STAGE[d.doc_type] ?? 'activity',
        title: `${prettify(d.doc_type)} collected`,
        detail: bits.length ? bits.join(' · ') : d.file_name, at: d.document_date || d.created_at,
      });
    }

    entries.sort((a, b) => (a.at! < b.at! ? -1 : a.at! > b.at! ? 1 : 0));
    return Response.json({ data: entries });
  },
  { serviceName: SERVICE_NAME },
);

function prettify(s: string | null): string {
  if (!s) return 'Update';
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
