/**
 * Chat → page handoff for label printing.
 * Isabelle's print_labels action stashes a batch here (sessionStorage) and fires
 * the event; the assets page consumes the batch and opens BarcodeLabelDialog
 * preloaded. The event covers the already-on-the-page case; the storage key
 * covers the navigate-then-mount case.
 */
import type { BarcodeLabelItem } from '@/components/modals/BarcodeLabelDialog';

export const PENDING_LABEL_BATCH_KEY = 'pending-label-batch';
export const PENDING_LABEL_BATCH_EVENT = 'label-batch:ready';

export interface PendingLabelBatch {
  items: BarcodeLabelItem[];
  entityType: 'asset' | 'tool' | 'item';
  warning?: string;
}

export function stashPendingLabelBatch(batch: PendingLabelBatch): void {
  sessionStorage.setItem(PENDING_LABEL_BATCH_KEY, JSON.stringify(batch));
  window.dispatchEvent(new Event(PENDING_LABEL_BATCH_EVENT));
}

/** Read and clear the pending batch. Returns null if none or malformed. */
export function consumePendingLabelBatch(): PendingLabelBatch | null {
  try {
    const raw = sessionStorage.getItem(PENDING_LABEL_BATCH_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_LABEL_BATCH_KEY);
    const batch = JSON.parse(raw) as PendingLabelBatch;
    if (!Array.isArray(batch?.items) || batch.items.length === 0) return null;
    return batch;
  } catch {
    return null;
  }
}
