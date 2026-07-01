/**
 * Vendor parser registry.
 *
 * Every vendor formats their receipts/emails differently. Rather than bloating
 * the core extractor with per-vendor branches, each vendor gets an optional
 * VendorParser that runs AFTER generic extraction to (a) refine the doc_type,
 * (b) pull vendor-specific identifiers the generic pass missed, and (c) provide
 * Gmail search hints for finding that vendor's mail.
 *
 * Adding a vendor = register a new parser here; the matching engine, extractor,
 * and routes never change. A parser is matched by sender domain or vendor code.
 */
import type { ExtractedDocument } from '../types';

export interface VendorParserContext {
  senderEmail: string | null;
  subject: string | null;
  vendorCode: string | null;
}

export interface VendorParser {
  key: string;
  /** Sender domains this parser handles (lowercased). */
  domains: string[];
  /** Vendor codes (supply_chain.vendors.code) this parser handles. */
  vendorCodes?: string[];
  /** Extra Gmail query fragments to help locate this vendor's documents. */
  gmailHints?: string[];
  /** Refine a generically-extracted document in place; return the result. */
  refine(doc: ExtractedDocument, ctx: VendorParserContext): ExtractedDocument;
}

/** Amazon Business — order confirmations, shipment notices, invoices. */
const amazonParser: VendorParser = {
  key: 'amazon_business',
  domains: ['amazon.com', 'business.amazon.com', 'marketplace.amazon.com'],
  vendorCodes: ['AMAZON-BIZ'],
  gmailHints: ['from:amazon.com', 'subject:(order OR shipped OR invoice)'],
  refine(doc, ctx) {
    const text = `${ctx.subject || ''}`;
    // Amazon order ids look like 123-1234567-1234567.
    const m = text.match(/\b(\d{3}-\d{7}-\d{7})\b/);
    if (m && !doc.order_number) doc.order_number = m[1];
    if (/shipped|out for delivery|on the way/i.test(text) && doc.doc_type === 'other') {
      doc.doc_type = 'shipping_notification';
    }
    return doc;
  },
};

/** Grainger — industrial supply invoices/order acknowledgements. */
const graingerParser: VendorParser = {
  key: 'grainger',
  domains: ['grainger.com', 'email.grainger.com'],
  vendorCodes: ['GRAINGER'],
  gmailHints: ['from:grainger.com'],
  refine(doc) {
    return doc; // generic extraction is sufficient; hook kept for future rules
  },
};

/** Home Depot / Pro — store & online receipts. */
const homeDepotParser: VendorParser = {
  key: 'home_depot',
  domains: ['homedepot.com', 'order.homedepot.com', 'email.homedepot.com'],
  vendorCodes: ['HOMEDEPOT', 'HD-PRO'],
  gmailHints: ['from:homedepot.com'],
  refine(doc) {
    return doc;
  },
};

const PARSERS: VendorParser[] = [amazonParser, graingerParser, homeDepotParser];

/** Resolve a parser by sender domain or vendor code (domain takes priority). */
export function resolveVendorParser(
  senderEmail: string | null,
  vendorCode: string | null,
): VendorParser | null {
  const domain = senderEmail && senderEmail.includes('@')
    ? senderEmail.split('@').pop()!.toLowerCase().trim()
    : null;
  if (domain) {
    const byDomain = PARSERS.find((p) => p.domains.some((d) => domain === d || domain.endsWith(`.${d}`)));
    if (byDomain) return byDomain;
  }
  if (vendorCode) {
    const code = vendorCode.toUpperCase();
    const byCode = PARSERS.find((p) => p.vendorCodes?.includes(code));
    if (byCode) return byCode;
  }
  return null;
}

/** Gmail search hints for a vendor, used to broaden the collection query. */
export function gmailHintsForVendor(vendorCode: string | null, domains: string[]): string[] {
  const hints = new Set<string>();
  const parser = resolveVendorParser(domains[0] ? `x@${domains[0]}` : null, vendorCode);
  parser?.gmailHints?.forEach((h) => hints.add(h));
  return Array.from(hints);
}

export function listVendorParsers(): VendorParser[] {
  return PARSERS;
}
