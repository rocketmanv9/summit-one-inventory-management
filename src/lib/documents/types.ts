/**
 * Intelligent Receipt Collector — shared types.
 *
 * The pipeline is deliberately layered so each stage can be swapped or extended
 * without touching the others:
 *
 *   DocumentSource  → raw candidate documents (Gmail today; Outlook / carrier /
 *                     bank feeds later — all provider-agnostic)
 *   DocumentExtractor → normalized ExtractedDocument (OCR/vision/text)
 *   VendorParser    → vendor-specific post-processing (Amazon, Grainger, …)
 *   matching engine → confidence score of a document against a purchase order
 *
 * Nothing above the source layer knows about Gmail; nothing below the matching
 * layer knows about purchase orders.
 */

/** The kinds of purchasing documents we collect across a purchase lifecycle. */
export type PurchaseDocType =
  | 'order_confirmation'
  | 'receipt'
  | 'invoice'
  | 'shipping_notification'
  | 'delivery_confirmation'
  | 'packing_slip'
  | 'credit_memo'
  | 'warranty'
  | 'other';

export const PURCHASE_DOC_TYPES: PurchaseDocType[] = [
  'order_confirmation',
  'receipt',
  'invoice',
  'shipping_notification',
  'delivery_confirmation',
  'packing_slip',
  'credit_memo',
  'warranty',
  'other',
];

/** A single extracted line item from a receipt/invoice. */
export interface ExtractedLineItem {
  description: string | null;
  sku: string | null;
  quantity: number | null;
  unit_price: number | null;
  amount: number | null;
}

/** Normalized structured data pulled from a document, provider-independent. */
export interface ExtractedDocument {
  doc_type: PurchaseDocType;
  vendor_name: string | null;
  po_number: string | null;
  order_number: string | null;
  invoice_number: string | null;
  receipt_number: string | null;
  tracking_numbers: string[];
  subtotal: number | null;
  tax: number | null;
  shipping: number | null;
  total: number | null;
  currency: string | null;
  payment_method: string | null;
  store_number: string | null;
  document_date: string | null; // YYYY-MM-DD
  line_items: ExtractedLineItem[];
  /** 0..1 — the extractor's confidence in the field values. */
  confidence: number;
  /** Extraction method used, for observability ('vision' | 'pdf_text' | 'text' | 'heuristic'). */
  method: string;
  /** First N chars of raw text, retained for audit / re-parsing. */
  raw_text_excerpt: string | null;
}

/** A raw candidate document surfaced by a source (before extraction). */
export interface RawDocument {
  /** Provider name: 'gmail' | 'upload' | 'outlook' | 'amazon' | 'bank_feed' … */
  source: string;
  /** Provider message/object id (Gmail messageId, etc.). */
  sourceRef: string | null;
  /** Attachment id within the message; null for an email body/HTML doc. */
  sourceAttachmentId: string | null;
  senderEmail: string | null;
  subject: string | null;
  receivedAt: string | null;
  fileName: string;
  contentType: string;
  /** File bytes (PDF/image). Null when the document IS the email body/html. */
  bytes: Uint8Array | null;
  /** Plain-text body (email body docs, or a text sidecar for context). */
  text: string | null;
  /** HTML body, when the document is an HTML receipt. */
  html: string | null;
}

/** Input to the extractor — a raw document plus optional matching context. */
export interface ExtractInput {
  fileName: string;
  contentType: string;
  bytes: Uint8Array | null;
  text: string | null;
  html: string | null;
  subject: string | null;
  senderEmail: string | null;
}

export interface DocumentExtractor {
  extract(input: ExtractInput): Promise<ExtractedDocument>;
}

/** Signals available to score a document against a specific purchase order. */
export interface PoMatchContext {
  poId: string;
  poNumber: string;
  externalOrderNumber: string | null;
  vendorId: string | null;
  vendorName: string | null;
  /** Known sender domains for the PO's vendor (lowercased). */
  vendorDomains: string[];
  /** Current computed PO total (sum of lines). */
  poTotal: number | null;
  orderDate: string | null; // YYYY-MM-DD
  /** Tracking numbers already recorded on the PO's shipments. */
  trackingNumbers: string[];
}

export interface MatchResult {
  confidence: number; // 0..1
  /** Per-signal contributions, for explainability in the UI. */
  signals: Record<string, number>;
  /** Whether at least one strong identifier (PO#, order#, tracking#) matched. */
  hasStrongSignal: boolean;
}

/** Confidence thresholds gating what the collector does with a match. */
export const MATCH_AUTO_THRESHOLD = 0.95; // auto-attach + reconcile
export const MATCH_SUGGEST_THRESHOLD = 0.7; // suggest for human review
