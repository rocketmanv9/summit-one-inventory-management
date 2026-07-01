/**
 * Document extractor — turns a raw purchasing document (PDF / image / HTML /
 * email body) into a normalized ExtractedDocument.
 *
 * Provider-agnostic OCR abstraction: today extraction is powered by OpenAI
 * vision + text models (the only AI provider wired into this codebase). Swapping
 * in a dedicated OCR/Document-AI provider later means implementing this one
 * `extract()` contract — nothing upstream changes.
 *
 * Strategy (per the chosen "text-first, vision fallback" approach):
 *   • PDF  → pull the text layer (pdfjs); read the text with the LLM. If the PDF
 *            is scanned (no text layer), fall back to vision on the first page
 *            when rasterization is available, else mark 'unsupported'.
 *   • image (jpeg/png/webp/gif) → OpenAI vision.
 *   • html / email body → strip to text, read with the LLM.
 */
import OpenAI from 'openai';
import type {
  DocumentExtractor,
  ExtractInput,
  ExtractedDocument,
  ExtractedLineItem,
  PurchaseDocType,
} from '../types';
import { PURCHASE_DOC_TYPES } from '../types';
import { extractPdfText } from './pdf-text';

const EXTRACTION_MODEL = 'gpt-4.1-mini'; // supports both text + vision, low cost

const JSON_SCHEMA = {
  name: 'purchase_document_extraction',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'doc_type', 'vendor_name', 'po_number', 'order_number', 'invoice_number',
      'receipt_number', 'tracking_numbers', 'subtotal', 'tax', 'shipping',
      'total', 'currency', 'payment_method', 'store_number', 'document_date',
      'line_items', 'confidence',
    ],
    properties: {
      doc_type: { type: 'string', enum: PURCHASE_DOC_TYPES },
      vendor_name: { type: ['string', 'null'] },
      po_number: { type: ['string', 'null'], description: 'Buyer purchase-order number if referenced.' },
      order_number: { type: ['string', 'null'], description: "The vendor's own order/sales-order number." },
      invoice_number: { type: ['string', 'null'] },
      receipt_number: { type: ['string', 'null'] },
      tracking_numbers: { type: 'array', items: { type: 'string' } },
      subtotal: { type: ['number', 'null'] },
      tax: { type: ['number', 'null'] },
      shipping: { type: ['number', 'null'] },
      total: { type: ['number', 'null'] },
      currency: { type: ['string', 'null'], description: 'ISO code, e.g. USD.' },
      payment_method: { type: ['string', 'null'], description: 'e.g. "Visa ****1234", "Net 30", "ACH".' },
      store_number: { type: ['string', 'null'] },
      document_date: { type: ['string', 'null'], description: 'YYYY-MM-DD of the document.' },
      line_items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['description', 'sku', 'quantity', 'unit_price', 'amount'],
          properties: {
            description: { type: ['string', 'null'] },
            sku: { type: ['string', 'null'] },
            quantity: { type: ['number', 'null'] },
            unit_price: { type: ['number', 'null'] },
            amount: { type: ['number', 'null'] },
          },
        },
      },
      confidence: { type: 'number', description: '0..1 confidence in the extracted values.' },
    },
  },
} as const;

const SYSTEM_PROMPT =
  'You extract structured data from a purchasing document (receipt, invoice, ' +
  'order confirmation, packing slip, shipping/delivery notice, credit memo, or ' +
  'warranty). Classify doc_type, then pull every field you can find. ' +
  'Distinguish the buyer PO number (po_number) from the vendor order number ' +
  '(order_number). Numbers must be plain numbers (no currency symbols). Dates ' +
  'must be ISO YYYY-MM-DD. Never invent identifiers, totals, or tracking ' +
  "numbers — use null when a field isn't present. Set confidence honestly.";

function emptyExtraction(method: string, docType: PurchaseDocType = 'other'): ExtractedDocument {
  return {
    doc_type: docType,
    vendor_name: null, po_number: null, order_number: null, invoice_number: null,
    receipt_number: null, tracking_numbers: [], subtotal: null, tax: null,
    shipping: null, total: null, currency: null, payment_method: null,
    store_number: null, document_date: null, line_items: [], confidence: 0,
    method, raw_text_excerpt: null,
  };
}

function normalize(parsed: any, method: string, rawExcerpt: string | null): ExtractedDocument {
  const num = (v: unknown): number | null =>
    v === null || v === undefined || v === '' ? null : (typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.\-]/g, '')) || null);
  const str = (v: unknown): string | null =>
    v === null || v === undefined ? null : String(v).trim() || null;
  const docType: PurchaseDocType = PURCHASE_DOC_TYPES.includes(parsed?.doc_type) ? parsed.doc_type : 'other';

  const lines: ExtractedLineItem[] = Array.isArray(parsed?.line_items)
    ? parsed.line_items.map((l: any) => ({
        description: str(l?.description),
        sku: str(l?.sku),
        quantity: num(l?.quantity),
        unit_price: num(l?.unit_price),
        amount: num(l?.amount),
      }))
    : [];

  const tracking: string[] = Array.isArray(parsed?.tracking_numbers)
    ? parsed.tracking_numbers.map((t: any) => str(t)).filter((t: string | null): t is string => !!t)
    : [];

  return {
    doc_type: docType,
    vendor_name: str(parsed?.vendor_name),
    po_number: str(parsed?.po_number),
    order_number: str(parsed?.order_number),
    invoice_number: str(parsed?.invoice_number),
    receipt_number: str(parsed?.receipt_number),
    tracking_numbers: tracking,
    subtotal: num(parsed?.subtotal),
    tax: num(parsed?.tax),
    shipping: num(parsed?.shipping),
    total: num(parsed?.total),
    currency: str(parsed?.currency),
    payment_method: str(parsed?.payment_method),
    store_number: str(parsed?.store_number),
    document_date: str(parsed?.document_date),
    line_items: lines,
    confidence: typeof parsed?.confidence === 'number' ? parsed.confidence : 0.5,
    method,
    raw_text_excerpt: rawExcerpt,
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]{2,}/g, ' ').replace(/\n{2,}/g, '\n').trim();
}

/** OpenAI-backed extractor implementing the DocumentExtractor contract. */
export class OpenAiDocumentExtractor implements DocumentExtractor {
  private readonly apiKey: string | undefined;
  constructor(apiKey = process.env.OPENAI_API_KEY) {
    this.apiKey = apiKey;
  }

  async extract(input: ExtractInput): Promise<ExtractedDocument> {
    const ct = (input.contentType || '').toLowerCase();
    const isImage = ct.startsWith('image/');
    const isPdf = ct === 'application/pdf' || /\.pdf$/i.test(input.fileName);
    const isHtml = ct.includes('html') || (!!input.html && !input.bytes);

    // 1. Text-first for PDFs.
    if (isPdf && input.bytes) {
      const pdf = await extractPdfText(input.bytes);
      if (pdf && !pdf.likelyScanned && pdf.text.length > 40) {
        return this.fromText(pdf.text, 'pdf_text', input);
      }
      // Scanned PDF with no text layer — vision rasterization not available in
      // this slice; record as unsupported so it surfaces for manual handling.
      if (pdf) return { ...emptyExtraction('pdf_text'), raw_text_excerpt: pdf.text.slice(0, 500) };
      // pdfjs unavailable — fall through to unsupported.
      return emptyExtraction('unsupported');
    }

    // 2. Vision for images.
    if (isImage && input.bytes) {
      return this.fromImage(input.bytes, ct || 'image/jpeg');
    }

    // 3. Text/HTML/email body.
    const text = input.text || (input.html ? stripHtml(input.html) : null);
    if (text && text.trim()) {
      return this.fromText(text, isHtml ? 'text' : 'text', input);
    }

    return emptyExtraction('unsupported');
  }

  private client(): OpenAI {
    return new OpenAI({ apiKey: this.apiKey });
  }

  private async fromText(text: string, method: string, input: ExtractInput): Promise<ExtractedDocument> {
    const excerpt = text.slice(0, 4000);
    if (!this.apiKey) return this.heuristic(text, method);
    try {
      const completion = await this.client().chat.completions.create({
        model: EXTRACTION_MODEL,
        temperature: 0,
        response_format: { type: 'json_schema', json_schema: JSON_SCHEMA as any },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content:
              (input.subject ? `Email subject: ${input.subject}\n` : '') +
              (input.senderEmail ? `From: ${input.senderEmail}\n` : '') +
              `\n--- Document text ---\n${text.slice(0, 12000)}`,
          },
        ],
      });
      const raw = completion.choices[0]?.message?.content;
      if (!raw) return this.heuristic(text, method);
      return normalize(JSON.parse(raw), method, excerpt);
    } catch {
      return this.heuristic(text, method);
    }
  }

  private async fromImage(bytes: Uint8Array, mime: string): Promise<ExtractedDocument> {
    if (!this.apiKey) return emptyExtraction('unsupported');
    try {
      const dataUrl = `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
      const completion = await this.client().chat.completions.create({
        model: EXTRACTION_MODEL,
        temperature: 0,
        response_format: { type: 'json_schema', json_schema: JSON_SCHEMA as any },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Extract the purchasing document data from this image.' },
              { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
            ] as any,
          },
        ],
      });
      const raw = completion.choices[0]?.message?.content;
      if (!raw) return emptyExtraction('vision');
      return normalize(JSON.parse(raw), 'vision', null);
    } catch {
      return emptyExtraction('vision');
    }
  }

  /** Zero-dependency fallback when no OpenAI key is configured. */
  private heuristic(text: string, method: string): ExtractedDocument {
    const doc = emptyExtraction(`${method}_heuristic`);
    doc.raw_text_excerpt = text.slice(0, 4000);
    const lower = text.toLowerCase();
    if (/(invoice)/.test(lower)) doc.doc_type = 'invoice';
    else if (/(receipt)/.test(lower)) doc.doc_type = 'receipt';
    else if (/(order confirmation|order confirmed|thank you for your order)/.test(lower)) doc.doc_type = 'order_confirmation';
    else if (/(shipped|tracking|out for delivery)/.test(lower)) doc.doc_type = 'shipping_notification';

    const inv = text.match(/invoice\s*#?\s*[:.]?\s*([A-Z0-9\-]{4,})/i);
    if (inv) doc.invoice_number = inv[1];
    const ord = text.match(/order\s*#?\s*[:.]?\s*([A-Z0-9\-]{4,})/i);
    if (ord) doc.order_number = ord[1];
    const total = text.match(/total[:\s]*\$?\s*([0-9][0-9,]*\.\d{2})/i);
    if (total) doc.total = Number(total[1].replace(/,/g, ''));
    const tracks = text.match(/\b(1Z[0-9A-Z]{16}|\d{12,22})\b/g);
    if (tracks) doc.tracking_numbers = Array.from(new Set(tracks)).slice(0, 5);
    doc.confidence = 0.3;
    return doc;
  }
}

let singleton: OpenAiDocumentExtractor | null = null;
export function getDocumentExtractor(): DocumentExtractor {
  if (!singleton) singleton = new OpenAiDocumentExtractor();
  return singleton;
}
