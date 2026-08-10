// Loose-tracking display helpers — shared so "~N", the estimate chip, and the
// staleness copy read identically wherever a loose item's quantity shows (item
// detail, cycle-count review, PO/receive pickers). We decorate existing qty
// surfaces; we don't redesign them.

/** Days after which an estimate is considered stale and worth re-truing. */
export const ESTIMATE_STALE_DAYS = 30;

/** Prefix a quantity with ~ for loose items, e.g. formatEstimateQty(12) → "~12". */
export function formatEstimateQty(value: string | number): string {
  return `~${value}`;
}

/**
 * Human staleness copy for a loose item's estimate, or null when it's fresh
 * (or never verified — a never-verified estimate reads as "not yet verified").
 * "estimate is 6 weeks old" style, rounded to the friendliest unit.
 */
export function estimateStaleness(lastVerifiedAt: string | null | undefined): {
  stale: boolean;
  label: string;
} {
  if (!lastVerifiedAt) {
    return { stale: true, label: 'estimate not yet verified' };
  }
  const then = new Date(lastVerifiedAt).getTime();
  if (Number.isNaN(then)) {
    return { stale: false, label: '' };
  }
  const days = Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24));
  if (days < ESTIMATE_STALE_DAYS) {
    return { stale: false, label: days <= 1 ? 'estimate verified today' : `estimate is ${days} days old` };
  }
  const weeks = Math.round(days / 7);
  if (weeks < 8) return { stale: true, label: `estimate is ${weeks} weeks old` };
  const months = Math.round(days / 30);
  return { stale: true, label: `estimate is ${months} months old` };
}
