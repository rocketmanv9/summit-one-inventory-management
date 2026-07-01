/**
 * Confidence-based matching engine.
 *
 * Scores how strongly an ExtractedDocument corresponds to a specific purchase
 * order, from a set of weighted, independent signals. Pure and deterministic so
 * it is unit-testable and identical whether invoked from a route, a cron, or a
 * future provider.
 *
 *   ≥ 0.95  → auto-attach + reconcile
 *   0.70..  → suggest for human review
 *   < 0.70  → leave unmatched
 *
 * A high score requires at least one STRONG identifier (PO#, vendor order#, or
 * tracking#). Weak-only signals (vendor + amount + date) are capped so a
 * same-vendor lookalike never auto-reconciles.
 */
import type { ExtractedDocument, MatchResult, PoMatchContext } from '../types';

/** Normalize an identifier for comparison: strip spaces/punctuation, uppercase. */
function normId(v: string | null | undefined): string {
  return (v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** True if `a` and `b` reference the same identifier (exact or contained). */
function idMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normId(a);
  const nb = normId(b);
  if (na.length < 3 || nb.length < 3) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

function domainOf(email: string | null | undefined): string | null {
  if (!email || !email.includes('@')) return null;
  return email.split('@').pop()!.toLowerCase().trim() || null;
}

export function scoreDocumentAgainstPo(
  doc: ExtractedDocument,
  ctx: PoMatchContext,
  senderEmail: string | null,
): MatchResult {
  const signals: Record<string, number> = {};
  let strong = false;

  // ── Strong identifiers ──────────────────────────────────────────────
  // The buyer PO number is unique + buyer-generated, so an exact hit is
  // near-definitive; a single corroborating signal (vendor domain or matching
  // total) then clears the auto-reconcile bar.
  if (idMatch(doc.po_number, ctx.poNumber)) {
    signals.po_number = 0.7;
    strong = true;
  }
  if (ctx.externalOrderNumber && idMatch(doc.order_number, ctx.externalOrderNumber)) {
    signals.order_number = 0.55;
    strong = true;
  }
  if (doc.tracking_numbers.length && ctx.trackingNumbers.length) {
    const hit = doc.tracking_numbers.some((dt) => ctx.trackingNumbers.some((pt) => idMatch(dt, pt)));
    if (hit) {
      signals.tracking_number = 0.5;
      strong = true;
    }
  }

  // ── Medium: vendor identity ─────────────────────────────────────────
  const senderDomain = domainOf(senderEmail);
  if (senderDomain && ctx.vendorDomains.includes(senderDomain)) {
    signals.vendor_domain = 0.25;
  } else if (doc.vendor_name && ctx.vendorName) {
    const dv = doc.vendor_name.toLowerCase();
    const pv = ctx.vendorName.toLowerCase();
    if (dv.includes(pv) || pv.includes(dv)) signals.vendor_name = 0.15;
  }

  // ── Medium: amount agreement (within 2%) ────────────────────────────
  if (doc.total != null && ctx.poTotal != null && ctx.poTotal > 0) {
    const diff = Math.abs(doc.total - ctx.poTotal) / ctx.poTotal;
    if (diff <= 0.02) signals.total = 0.2;
    else if (diff <= 0.1) signals.total = 0.1;
  }

  // ── Weak: date proximity (doc within [order, order+45d]) ─────────────
  if (doc.document_date && ctx.orderDate) {
    const d = Date.parse(doc.document_date);
    const o = Date.parse(ctx.orderDate);
    if (!Number.isNaN(d) && !Number.isNaN(o)) {
      const days = (d - o) / 86_400_000;
      if (days >= -2 && days <= 45) signals.date = 0.1;
    }
  }

  let confidence = Object.values(signals).reduce((a, b) => a + b, 0);
  // Cap weak-only matches so a same-vendor lookalike never auto-reconciles.
  if (!strong) confidence = Math.min(confidence, 0.6);
  confidence = Math.max(0, Math.min(1, confidence));

  return { confidence: Number(confidence.toFixed(3)), signals, hasStrongSignal: strong };
}
