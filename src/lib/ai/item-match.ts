// Shared, LLM-free name-matching primitives for Isabelle's item resolution.
//
// These were originally private to recommend-vendor.ts (the rescue that taught the
// procure recommender to fold plurals). They now live here so EVERY item resolver
// singularizes and token-matches identically — notably execute-action's own
// resolveItem(), which previously did a bare `ilike %<raw>%` and missed "Fuel Cans"
// against the "Fuel Can" catalog row. One matcher, no forks.
//
// Pure string helpers — no I/O, no Supabase. Server-and-edge safe.

/** Lowercase, collapse whitespace and punctuation for token comparison. */
export function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

/**
 * Lightweight English singularizer so "Fuel Cans" resolves to "Fuel Can".
 * Not a full stemmer — just folds the common plural endings so token-overlap
 * scoring and ilike matching don't miss on a trailing "s". Leaves short words
 * ("gas", "ppe") and already-singular words alone.
 */
export function singularize(w: string): string {
  if (w.length <= 3) return w;
  if (/(ss|us|is)$/.test(w)) return w; // glass, status, axis — not plurals
  if (/ies$/.test(w)) return w.slice(0, -3) + 'y'; // batteries → battery
  if (/(ches|shes|xes|zes|ses)$/.test(w)) return w.slice(0, -2); // boxes → box
  if (/s$/.test(w)) return w.slice(0, -1); // cans → can
  return w;
}

/** Normalize → split → drop 1-char tokens → singularize. */
export function tokens(s: string): string[] {
  return norm(s)
    .split(' ')
    .filter((t) => t.length > 1)
    .map(singularize);
}

/**
 * Jaccard token-overlap score between two strings, singularized. 0..1.
 * Both empty (or no shared tokens) → 0. Used to fuzzy-rank catalog names when a
 * plain ilike misses (e.g. plural query vs singular catalog row).
 */
export function tokenOverlapScore(a: string, b: string): number {
  const aToks = new Set(tokens(a));
  const bToks = new Set(tokens(b));
  if (aToks.size === 0 || bToks.size === 0) return 0;
  let inter = 0;
  for (const t of aToks) if (bToks.has(t)) inter++;
  if (inter === 0) return 0;
  const union = aToks.size + bToks.size - inter;
  return inter / union;
}

/**
 * A singularized wildcard pattern for an ilike fallback: "Fuel Cans" → "%fuel%can%".
 * Folds each query token's plural so an ilike can catch the singular catalog row.
 * Returns null when there are no usable tokens (caller should skip the ilike).
 */
export function singularizedIlikePattern(raw: string): string | null {
  const toks = tokens(raw);
  if (toks.length === 0) return null;
  return `%${toks.join('%')}%`;
}
