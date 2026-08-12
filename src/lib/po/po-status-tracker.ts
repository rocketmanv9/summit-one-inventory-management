/**
 * PO status tracker — turns AI-extracted vendor-reply actions into PO updates.
 *
 * Hybrid autonomy:
 *   • SAFE + high confidence  → auto-applied to the PO immediately
 *       - expected_delivery_date (confidence ≥ 0.70)
 *       - external_order_number  (confidence ≥ 0.70, only if currently empty)
 *       - status placed/approved → acknowledged (confidence ≥ 0.80)
 *   • Destructive / uncertain → queued as a 'suggested' row for one-click confirm
 *       - cancellation, price change, quantity change, backorder, questions,
 *         or anything below the confidence thresholds
 *
 * Every interpretation produces a row in purchase_order_suggestions, which also
 * serves as the per-PO "vendor activity" timeline.
 */
import { AppError } from '@rocketmanv9/chassis/errors';
import { extractReplyInsights, type ReplyAction } from './reply-extractor';

type AdminClient = any;
type FetchLike = typeof fetch;

const ACK_MIN_CONFIDENCE = 0.8;
const DATE_MIN_CONFIDENCE = 0.7;

/** PO statuses a vendor email is allowed to set (never received/closed). */
const EMAIL_SETTABLE_STATUS = new Set(['acknowledged', 'cancelled']);
const ACK_FROM = new Set(['placed', 'approved']);
const TERMINAL = new Set(['fully_received', 'closed', 'cancelled']);
/** States a tracking number must never pull back to in_transit (mirrors the Amazon ship-notice webhook). */
const TRANSIT_LOCKED = new Set(['partially_received', 'fully_received', 'received', 'closed', 'cancelled', 'voided', 'in_transit']);

export interface POSnapshot {
  id: string;
  po_number: string;
  status: string;
  expected_delivery_date: string | null;
  external_order_number: string | null;
  vendor_name_snapshot: string | null;
}

interface PlannedAction {
  changes: Record<string, unknown>; // full set for display (incl. tracking/items)
  applyable: Record<string, unknown>; // subset the PO actually accepts
  auto: boolean;
}

function sc(admin: AdminClient) {
  return admin.schema('supply_chain');
}

async function getPOSnapshot(admin: AdminClient, tenantId: string, poId: string): Promise<POSnapshot | null> {
  const { data } = await sc(admin)
    .from('purchase_orders')
    .select('id, po_number, status, expected_delivery_date, external_order_number, vendor_name_snapshot')
    .eq('id', poId)
    .eq('tenant_id', tenantId)
    .limit(1)
    .maybeSingle();
  return (data as POSnapshot) ?? null;
}

/** Decide what a single extracted action proposes, and whether it's auto-safe. */
function planAction(action: ReplyAction, po: POSnapshot): PlannedAction {
  const changes: Record<string, unknown> = {};
  const applyable: Record<string, unknown> = {};

  // Non-destructive informational fields.
  if (action.expected_delivery_date) {
    changes.expected_delivery_date = action.expected_delivery_date;
    applyable.expected_delivery_date = action.expected_delivery_date;
  }
  if (action.external_order_number && !po.external_order_number) {
    changes.external_order_number = action.external_order_number;
    applyable.external_order_number = action.external_order_number;
  }
  if (action.tracking_number) {
    // Stored as a supply_chain.po_shipments row so the globe map can draw
    // the in-transit package, mirroring the Amazon ship-notice webhook.
    changes.tracking_number = action.tracking_number;
    applyable.tracking_number = action.tracking_number;
  }
  if (action.items?.length) changes.items = action.items; // display only

  // Status transitions.
  let statusChange: 'acknowledged' | 'cancelled' | null = null;
  if (action.type === 'acknowledged' && ACK_FROM.has(po.status)) {
    statusChange = 'acknowledged';
  } else if (action.type === 'cancelled' && !TERMINAL.has(po.status)) {
    statusChange = 'cancelled';
  } else if (
    (action.type === 'shipped' || action.type === 'delivery_update') &&
    ACK_FROM.has(po.status)
  ) {
    // A ship/delivery note also implies the vendor accepted the order.
    statusChange = 'acknowledged';
  }
  if (statusChange) {
    changes.status = statusChange;
    applyable.status = statusChange;
  }

  // Autonomy decision.
  let auto = false;
  const destructive = action.type === 'cancelled' || statusChange === 'cancelled';
  const needsHuman =
    action.type === 'price_change' ||
    action.type === 'qty_change' ||
    action.type === 'backordered' ||
    action.type === 'question' ||
    action.type === 'other';

  if (!destructive && !needsHuman) {
    if (applyable.status === 'acknowledged') {
      auto = action.confidence >= ACK_MIN_CONFIDENCE;
    } else if (Object.keys(applyable).length > 0) {
      auto = action.confidence >= DATE_MIN_CONFIDENCE;
    } else {
      // Pure informational (e.g. "shipped", no date) — record but don't pester.
      auto = action.confidence >= DATE_MIN_CONFIDENCE;
    }
  }

  return { changes, applyable, auto };
}

/** Apply a whitelisted change-set to the PO. Returns human labels of what changed. */
export async function applyChangesToPO(
  admin: AdminClient,
  tenantId: string,
  po: POSnapshot,
  changes: Record<string, unknown>,
): Promise<string[]> {
  const update: Record<string, unknown> = {};
  const labels: string[] = [];

  if (typeof changes.expected_delivery_date === 'string') {
    update.expected_delivery_date = changes.expected_delivery_date;
    labels.push(`expected delivery ${changes.expected_delivery_date}`);
  }
  if (typeof changes.external_order_number === 'string' && !po.external_order_number) {
    update.external_order_number = changes.external_order_number;
    labels.push(`vendor order # ${changes.external_order_number}`);
  }
  if (typeof changes.status === 'string' && EMAIL_SETTABLE_STATUS.has(changes.status)) {
    // Guard transitions: acknowledged only from placed/approved; cancel unless terminal.
    if (changes.status === 'acknowledged' && ACK_FROM.has(po.status)) {
      update.status = 'acknowledged';
      labels.push('status → acknowledged');
    } else if (changes.status === 'cancelled' && !TERMINAL.has(po.status)) {
      update.status = 'cancelled';
      labels.push('status → cancelled');
    }
  }

  // A tracking number means the order shipped: record the shipment (feeds the
  // globe map) and advance the PO to in_transit unless a later state is locked
  // in — the same behavior as the Amazon ship-notice webhook.
  if (typeof changes.tracking_number === 'string' && changes.tracking_number.trim()) {
    const trackingNumber = changes.tracking_number.trim();
    const deliveryDate =
      (typeof changes.expected_delivery_date === 'string' && changes.expected_delivery_date) ||
      po.expected_delivery_date ||
      null;

    const { error: shipErr } = await sc(admin)
      .from('po_shipments')
      .upsert({
        tenant_id: tenantId,
        purchase_order_id: po.id,
        tracking_number: trackingNumber,
        ship_date: new Date().toISOString(),
        delivery_date: deliveryDate,
        source: 'email',
        last_event_id: `email_ship_${po.id}_${trackingNumber}`,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'tenant_id,purchase_order_id,tracking_number' });
    if (shipErr) throw AppError.internal(`Failed to record shipment: ${shipErr.message}`);
    labels.push(`tracking # ${trackingNumber}`);

    if (!TRANSIT_LOCKED.has((po.status || '').toLowerCase()) && update.status !== 'cancelled') {
      update.status = 'in_transit';
      labels.push('status → in transit');
    }
  }

  if (Object.keys(update).length === 0) return labels;

  const { error } = await sc(admin)
    .from('purchase_orders')
    .update(update)
    .eq('id', po.id)
    .eq('tenant_id', tenantId);
  if (error) throw AppError.internal(`Failed to update PO: ${error.message}`);

  // Reflect locally so later actions on the same reply see the new state.
  Object.assign(po, update);
  return labels;
}

export interface ProcessReplyResult {
  autoApplied: number;
  suggested: number;
}

export interface ReplyToProcess {
  id: string;
  purchase_order_id: string;
  subject: string | null;
  body_text: string | null;
  snippet: string | null;
}

/** Extract → write-back → plan → auto-apply/suggest for a single reply. */
export async function processReply(
  admin: AdminClient,
  tenantId: string,
  reply: ReplyToProcess,
  fetchImpl: FetchLike,
): Promise<ProcessReplyResult> {
  const po = await getPOSnapshot(admin, tenantId, reply.purchase_order_id);
  if (!po) return { autoApplied: 0, suggested: 0 };

  const extraction = await extractReplyInsights({
    subject: reply.subject,
    bodyText: reply.body_text,
    snippet: reply.snippet,
    poNumber: po.po_number,
    vendorName: po.vendor_name_snapshot ?? 'Vendor',
    currentExpectedDelivery: po.expected_delivery_date,
  });

  const primary = extraction.actions[0];
  await sc(admin)
    .from('purchase_order_email_replies')
    .update({
      event_type: primary?.type ?? 'other',
      confidence: extraction.overall_confidence,
      summary: extraction.summary,
      extracted: extraction as unknown as Record<string, unknown>,
      processed_at: new Date().toISOString(),
    })
    .eq('id', reply.id)
    .eq('tenant_id', tenantId);

  let autoApplied = 0;
  let suggested = 0;

  for (const action of extraction.actions) {
    const plan = planAction(action, po);
    const row: Record<string, unknown> = {
      tenant_id: tenantId,
      purchase_order_id: po.id,
      reply_id: reply.id,
      event_type: action.type,
      confidence: action.confidence,
      summary: action.detail,
      proposed_changes: plan.changes,
      last_event_id: crypto.randomUUID(),
    };

    if (plan.auto) {
      try {
        await applyChangesToPO(admin, tenantId, po, plan.applyable);
      } catch {
        // If the auto-apply fails, fall back to a suggestion so nothing is lost.
        plan.auto = false;
      }
    }

    row.status = plan.auto ? 'auto_applied' : 'suggested';
    if (plan.auto) row.applied_at = new Date().toISOString();

    await sc(admin).from('purchase_order_suggestions').insert(row);
    if (plan.auto) autoApplied += 1;
    else suggested += 1;
  }

  return { autoApplied, suggested };
}

/** Process any replies that haven't been interpreted yet (safety net / backfill). */
export async function processUnprocessedReplies(
  admin: AdminClient,
  tenantId: string,
  fetchImpl: FetchLike,
  limit = 50,
): Promise<ProcessReplyResult> {
  const { data } = await sc(admin)
    .from('purchase_order_email_replies')
    .select('id, purchase_order_id, subject, body_text, snippet')
    .eq('tenant_id', tenantId)
    .is('processed_at', null)
    .not('purchase_order_id', 'is', null)
    .order('created_at', { ascending: true })
    .limit(limit);

  let autoApplied = 0;
  let suggested = 0;
  for (const reply of (data as ReplyToProcess[]) ?? []) {
    try {
      const r = await processReply(admin, tenantId, reply, fetchImpl);
      autoApplied += r.autoApplied;
      suggested += r.suggested;
    } catch {
      // skip a problematic reply; it stays unprocessed for a later pass
    }
  }
  return { autoApplied, suggested };
}

/**
 * Apply (or dismiss) a queued suggestion. Returns the updated PO labels.
 */
export async function resolveSuggestion(
  admin: AdminClient,
  tenantId: string,
  suggestionId: string,
  action: 'apply' | 'dismiss',
  userId: string,
): Promise<{ status: string; applied: string[]; purchaseOrderId: string }> {
  const { data: suggestion } = await sc(admin)
    .from('purchase_order_suggestions')
    .select('id, purchase_order_id, status, proposed_changes')
    .eq('id', suggestionId)
    .eq('tenant_id', tenantId)
    .limit(1)
    .maybeSingle();
  if (!suggestion) throw AppError.notFound('Suggestion not found.');
  if (suggestion.status !== 'suggested') {
    throw AppError.conflict(`Suggestion already ${suggestion.status}.`);
  }

  let applied: string[] = [];
  let newStatus: string;
  if (action === 'apply') {
    const po = await getPOSnapshot(admin, tenantId, suggestion.purchase_order_id);
    if (!po) throw AppError.notFound('Purchase order not found.');
    applied = await applyChangesToPO(admin, tenantId, po, suggestion.proposed_changes ?? {});
    newStatus = 'applied';
  } else {
    newStatus = 'dismissed';
  }

  await sc(admin)
    .from('purchase_order_suggestions')
    .update({
      status: newStatus,
      applied_by_user_id: userId,
      applied_at: new Date().toISOString(),
    })
    .eq('id', suggestionId)
    .eq('tenant_id', tenantId);

  return { status: newStatus, applied, purchaseOrderId: suggestion.purchase_order_id };
}
