/**
 * Vendor sender-domain helpers, shared by the vendor create (POST) and edit
 * (PATCH) routes so domains saved at quick-add time stay visible and editable
 * in the full form (they power email → item-suggestion matching).
 */

const FREEMAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
  'aol.com', 'icloud.com', 'me.com', 'live.com',
]);

/** Normalize to bare lowercase domains; drop freemail/invalid; dedupe; cap 5. */
export function sanitizeEmailDomains(domains: string[] | undefined): string[] {
  const out = new Set<string>();
  for (const raw of domains ?? []) {
    let d = raw.trim().toLowerCase()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
      .replace(/^www\./, '');
    d = d.split(/[/?#\s]/)[0] || '';
    if (d.includes('@')) d = d.split('@')[1] || '';
    if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(d)) continue;
    if (FREEMAIL_DOMAINS.has(d)) continue;
    out.add(d);
    if (out.size >= 5) break;
  }
  return [...out];
}

/** Upsert sender domains for a vendor. Non-fatal — the vendor row is already
 *  written, so a failure here logs instead of failing (and re-running) the save. */
export async function upsertVendorEmailDomains(
  sc: any,
  log: { error: (msg: string, meta?: Record<string, unknown>) => void },
  tenantId: string,
  vendorId: string,
  domains: string[],
) {
  if (domains.length === 0) return;
  const rows = domains.map((domain) => ({
    tenant_id: tenantId,
    vendor_id: vendorId,
    domain,
    source: 'ai_suggest',
    is_active: true,
  }));
  const { error } = await sc
    .from('vendor_email_domains')
    .upsert(rows, { onConflict: 'tenant_id,vendor_id,domain' });
  if (error) log.error('vendor.email_domains_upsert_failed', { error: error.message, vendor_id: vendorId });
}
