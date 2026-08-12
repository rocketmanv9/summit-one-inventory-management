/**
 * Reference links attached to a catalog item.
 *
 * A free-form list of labelled URLs (product pages, spec sheets, supplier
 * portals). Stored in `inventory.catalog_items.reference_links` as jsonb.
 * Distinct from the Amazon/vendor_items mapping system — these are plain
 * reference URLs, not orderable vendor SKUs.
 */
export interface ReferenceLink {
  label: string;
  url: string;
}

/** Trim every field and drop rows with no URL. Use before persisting. */
export function cleanReferenceLinks(links: ReferenceLink[]): ReferenceLink[] {
  return links
    .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
    .filter((l) => l.url !== '');
}

/** Defensively coerce arbitrary jsonb (from the DB) into a ReferenceLink[]. */
export function parseReferenceLinks(value: unknown): ReferenceLink[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is Record<string, unknown> => !!v && typeof v === 'object')
    .map((v) => ({ label: String(v.label ?? ''), url: String(v.url ?? '') }))
    .filter((l) => l.url !== '');
}

/** Add a protocol if the user pasted a bare host, so the anchor is clickable. */
export function normalizeHref(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}
