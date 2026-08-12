/**
 * Purchase-order status model for the simplified Summit One flow.
 *
 * Stored PO statuses are free-text and historically span a long chain
 * (draft → awaiting_approval → approved → placed → acknowledged →
 * partially_received → fully_received → closed, plus cancelled/voided).
 * The UI collapses these into five user-facing buckets and a fixed set of
 * actions per bucket. This is the single source of truth reused by the
 * purchasing page, the detail panel, summary cards, and the status filter.
 */

export type PoBucket =
  | 'draft'
  | 'sent'
  | 'partially_received'
  | 'received'
  | 'cancelled';

export type PoActionKey =
  | 'edit'
  | 'send'
  | 'delete'
  | 'receive'
  | 'view_pdf'
  | 'resend'
  | 'cancel';

/** Vendor codes whose ordering happens through an external integration. */
export const INTEGRATION_VENDOR_CODES = ['AMAZON-BIZ', 'PRINTIFY'];

/** Map a stored PO status to its display bucket. */
export function poBucket(status: string | null | undefined): PoBucket {
  switch ((status || '').toLowerCase()) {
    case 'cancelled':
    case 'voided':
      return 'cancelled';
    case 'partially_received':
      return 'partially_received';
    case 'received':
    case 'fully_received':
    case 'closed':
      return 'received';
    case 'sent':
    case 'placed':
    case 'acknowledged':
    case 'in_transit':
    case 'ordered':
      return 'sent';
    // draft, awaiting_approval, approved, and anything unknown → draft
    default:
      return 'draft';
  }
}

const BUCKET_LABELS: Record<PoBucket, string> = {
  draft: 'Draft',
  sent: 'Sent',
  partially_received: 'Partially Received',
  received: 'Received',
  cancelled: 'Cancelled',
};

/** Human label for a bucket (also the StatusChip text for PO rows). */
export function poBucketLabel(bucket: PoBucket): string {
  return BUCKET_LABELS[bucket];
}

/**
 * Status-chip label for a stored PO status. Normally the bucket label, but
 * surfaces a distinct "In Transit" for shipped POs: they stay in the `sent`
 * bucket (so the status filter and the "Receive Materials" action keep working)
 * while the chip reflects that the order is physically on its way.
 */
export function poStatusChipLabel(status: string | null | undefined): string {
  const s = (status || '').toLowerCase();
  if (s === 'in_transit' || s === 'shipped') return 'In Transit';
  return poBucketLabel(poBucket(status));
}

/** All stored statuses that fall into a given bucket — used for DB filtering. */
export function statusesForBucket(bucket: PoBucket): string[] {
  switch (bucket) {
    case 'draft':
      return ['draft', 'awaiting_approval', 'approved'];
    case 'sent':
      return ['sent', 'placed', 'acknowledged', 'in_transit', 'ordered'];
    case 'partially_received':
      return ['partially_received'];
    case 'received':
      return ['received', 'fully_received', 'closed'];
    case 'cancelled':
      return ['cancelled', 'voided'];
  }
}

export interface PoAction {
  key: PoActionKey;
  label: string;
  /** Destructive styling hint for the action menu. */
  variant?: 'default' | 'danger';
}

/**
 * Valid actions for a bucket. Integration vendors (Amazon punchout, Printify)
 * still expose "Send PO" — the caller routes it to the punchout modal instead
 * of the email confirm step.
 */
export function poActions(bucket: PoBucket): PoAction[] {
  switch (bucket) {
    case 'draft':
      return [
        { key: 'edit', label: 'Edit' },
        { key: 'send', label: 'Send PO' },
        { key: 'delete', label: 'Delete', variant: 'danger' },
      ];
    case 'sent':
      return [
        { key: 'receive', label: 'Receive Materials' },
        { key: 'view_pdf', label: 'View PDF' },
        { key: 'resend', label: 'Resend' },
        { key: 'cancel', label: 'Cancel', variant: 'danger' },
      ];
    case 'partially_received':
      return [
        { key: 'receive', label: 'Receive Materials' },
        { key: 'view_pdf', label: 'View PDF' },
        { key: 'cancel', label: 'Cancel', variant: 'danger' },
      ];
    case 'received':
      return [{ key: 'view_pdf', label: 'View PDF' }];
    case 'cancelled':
      return [{ key: 'view_pdf', label: 'View PDF' }];
  }
}
