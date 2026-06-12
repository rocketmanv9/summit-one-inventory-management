/**
 * "Your order looks delivered — confirm receipt?" nudges.
 *
 * Finds POs still in_transit / partially_received whose expected arrival
 * (PO expected_delivery_date, or any shipment's promised delivery date) is at
 * least a day past, then emails the PO's creator a digest and drops an in-app
 * notification. receipt_nudge_sent_at throttles re-nudges to every 3 days.
 *
 * Per-PO failures are isolated; one bad PO never aborts the rest.
 */
import { AppError } from '@rocketmanv9/chassis/errors';
import { getAdminClient } from '@/utils/supabase/admin';
import { sendEmail, isEmailConfigured } from '@/lib/email/send';
import { insertNotification } from '@/lib/notifications';

type FetchLike = typeof fetch;
type Logger = { info: (msg: string, meta?: any) => void; warn: (msg: string, meta?: any) => void };

interface OverduePO {
  id: string;
  tenant_id: string;
  po_number: string;
  vendor_name_snapshot: string | null;
  expected_delivery_date: string | null;
  created_by_user_id: string | null;
  due_date: string;
}

export interface NudgeSummary {
  posNudged: number;
  emailsSent: number;
  emailsSkipped: number;
  notificationsCreated: number;
  errors: Array<{ poId: string; error: string }>;
}

function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SERVICE_BASE_URL || '').replace(/\/$/, '');
}

function fmtDate(d: string): string {
  const date = new Date(`${d}T00:00:00`);
  if (isNaN(date.getTime())) return d;
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export async function sendReceiptNudges(args: {
  fetchImpl: FetchLike;
  log: Logger;
  maxPOs?: number;
}): Promise<NudgeSummary> {
  const { fetchImpl, log } = args;
  const maxPOs = args.maxPOs ?? 50;
  const admin = getAdminClient();
  const sc = (admin as any).schema('supply_chain');
  const inv = (admin as any).schema('inventory');

  const summary: NudgeSummary = {
    posNudged: 0,
    emailsSent: 0,
    emailsSkipped: 0,
    notificationsCreated: 0,
    errors: [],
  };

  // POs that should have arrived by yesterday and haven't been nudged recently
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const renudgeBefore = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

  const { data: pos, error: posErr } = await sc
    .from('purchase_orders')
    .select('id, tenant_id, po_number, vendor_name_snapshot, expected_delivery_date, created_by_user_id, receipt_nudge_sent_at')
    .in('status', ['in_transit', 'partially_received'])
    .order('expected_delivery_date')
    .limit(500);
  if (posErr) {
    log.warn('receipt_nudges.query_failed', { error: posErr.message });
    return summary;
  }

  const candidates = (pos || []).filter(
    (po: any) => !po.receipt_nudge_sent_at || po.receipt_nudge_sent_at < renudgeBefore
  );
  if (candidates.length === 0) return summary;

  // Latest promised delivery per PO from shipment data (Amazon webhook
  // shipments live in punchout metadata; email-extracted ones in po_shipments).
  const poIds = candidates.map((po: any) => po.id);
  const [shipRes, punchRes] = await Promise.all([
    sc.from('po_shipments')
      .select('purchase_order_id, delivery_date')
      .in('purchase_order_id', poIds)
      .limit(500),
    inv.from('punchout_orders')
      .select('purchase_order_id, metadata')
      .in('purchase_order_id', poIds)
      .limit(500),
  ]);

  const latestShipmentEta = new Map<string, string>();
  const noteEta = (poId: string, eta?: string | null) => {
    if (!eta) return;
    const day = eta.slice(0, 10);
    const prev = latestShipmentEta.get(poId);
    if (!prev || day > prev) latestShipmentEta.set(poId, day);
  };
  for (const s of shipRes.data || []) noteEta(s.purchase_order_id, s.delivery_date);
  for (const p of punchRes.data || []) {
    const shipments = Array.isArray(p.metadata?.shipments) ? p.metadata.shipments : [];
    for (const s of shipments) noteEta(p.purchase_order_id, s.delivery_date);
  }

  const overdue: OverduePO[] = candidates
    .map((po: any) => {
      const due = latestShipmentEta.get(po.id)
        || (po.expected_delivery_date ? String(po.expected_delivery_date).slice(0, 10) : null);
      return due && due <= cutoff ? { ...po, due_date: due } : null;
    })
    .filter(Boolean)
    .slice(0, maxPOs) as OverduePO[];

  if (overdue.length === 0) return summary;

  // Group by tenant + recipient so each person gets one digest.
  const byRecipient = new Map<string, OverduePO[]>();
  for (const po of overdue) {
    const key = `${po.tenant_id}:${po.created_by_user_id || 'tenant'}`;
    if (!byRecipient.has(key)) byRecipient.set(key, []);
    byRecipient.get(key)!.push(po);
  }

  const base = appBaseUrl();
  const purchasingLink = base ? `${base}/inventory/purchasing` : null;

  for (const [, pos] of byRecipient) {
    const tenantId = pos[0].tenant_id;
    const userId = pos[0].created_by_user_id;
    try {
      // In-app notification per PO (deterministic key includes the due date
      // so a later re-nudge creates a fresh entry, but cron retries dedupe).
      for (const po of pos) {
        await insertNotification(admin, log, {
          tenantId,
          userId,
          type: 'po_arrival',
          title: `PO ${po.po_number} should have arrived`,
          body: `${po.vendor_name_snapshot || 'Vendor'} order was due ${fmtDate(po.due_date)} — confirm receipt to update stock.`,
          link: '/inventory/purchasing',
          eventKey: `po_arrival_${po.id}_${po.due_date}`,
        });
        summary.notificationsCreated++;
      }

      // Email digest
      let email: string | null = process.env.REORDER_DIGEST_EMAIL || null;
      if (userId) {
        const { data: user } = await (admin as any)
          .from('local_users')
          .select('email')
          .eq('tenant_id', tenantId)
          .eq('user_id', userId)
          .maybeSingle();
        if (user?.email) email = user.email;
      }

      if (email && isEmailConfigured()) {
        const rows = pos.map((po) =>
          `<li><strong>${po.po_number}</strong> — ${po.vendor_name_snapshot || 'Vendor'}, due ${fmtDate(po.due_date)}</li>`
        ).join('');
        await sendEmail(fetchImpl, {
          to: email,
          subject: pos.length === 1
            ? `Did PO ${pos[0].po_number} arrive? Confirm receipt`
            : `${pos.length} POs look delivered — confirm receipts`,
          html: `
            <p>These orders were due to arrive but haven't been received in inventory:</p>
            <ul>${rows}</ul>
            <p>Confirming a receipt updates stock levels and closes out the PO.</p>
            ${purchasingLink ? `<p><a href="${purchasingLink}">Open Purchasing</a> and use the Receive action.</p>` : ''}
            <p style="color:#888;font-size:12px">Summit One Inventory</p>
          `,
          text: [
            'These orders were due to arrive but have not been received:',
            ...pos.map((po) => `- ${po.po_number} (${po.vendor_name_snapshot || 'Vendor'}, due ${fmtDate(po.due_date)})`),
            purchasingLink ? `Open Purchasing: ${purchasingLink}` : '',
          ].filter(Boolean).join('\n'),
        });
        summary.emailsSent++;
      } else {
        summary.emailsSkipped++;
      }

      // Stamp the nudge so we don't nag again for 3 days
      const { error: stampErr } = await sc
        .from('purchase_orders')
        .update({ receipt_nudge_sent_at: new Date().toISOString() })
        .in('id', pos.map((po) => po.id));
      if (stampErr) throw AppError.internal(stampErr.message);

      summary.posNudged += pos.length;
    } catch (err: any) {
      log.warn('receipt_nudges.group_failed', { tenantId, error: err?.message });
      summary.errors.push({ poId: pos[0].id, error: err?.message || String(err) });
    }
  }

  return summary;
}
