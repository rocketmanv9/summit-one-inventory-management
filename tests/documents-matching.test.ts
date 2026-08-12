import { describe, it, expect } from 'vitest';
import { scoreDocumentAgainstPo } from '@/lib/documents/matching/engine';
import { buildGmailQueryForPo } from '@/lib/documents/store';
import type { ExtractedDocument, PoMatchContext } from '@/lib/documents/types';

function doc(overrides: Partial<ExtractedDocument> = {}): ExtractedDocument {
  return {
    doc_type: 'invoice', vendor_name: null, po_number: null, order_number: null,
    invoice_number: null, receipt_number: null, tracking_numbers: [], subtotal: null,
    tax: null, shipping: null, total: null, currency: 'USD', payment_method: null,
    store_number: null, document_date: null, line_items: [], confidence: 0.9,
    method: 'text', raw_text_excerpt: null, ...overrides,
  };
}

const ctx: PoMatchContext = {
  poId: 'po-1', poNumber: '26-0027', externalOrderNumber: 'ORD-9', vendorId: 'v1',
  vendorName: 'Grainger', vendorDomains: ['grainger.com'], poTotal: 100,
  orderDate: '2026-06-01', trackingNumbers: ['1Z999AA10123456784'],
};

describe('scoreDocumentAgainstPo', () => {
  it('auto-matches on an exact PO number (strong signal)', () => {
    const r = scoreDocumentAgainstPo(doc({ po_number: '26-0027' }), ctx, 'billing@grainger.com');
    expect(r.hasStrongSignal).toBe(true);
    expect(r.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it('normalizes punctuation/spacing when comparing identifiers', () => {
    const r = scoreDocumentAgainstPo(doc({ po_number: '26 0027' }), ctx, null);
    expect(r.signals.po_number).toBeGreaterThan(0);
  });

  it('matches on tracking number', () => {
    const r = scoreDocumentAgainstPo(doc({ tracking_numbers: ['1Z999AA10123456784'] }), ctx, null);
    expect(r.hasStrongSignal).toBe(true);
    expect(r.signals.tracking_number).toBeGreaterThan(0);
  });

  it('caps weak-only matches below the auto threshold', () => {
    // Same vendor + same amount + same date, but NO strong identifier.
    const r = scoreDocumentAgainstPo(
      doc({ vendor_name: 'Grainger', total: 100, document_date: '2026-06-03' }),
      ctx,
      'billing@grainger.com',
    );
    expect(r.hasStrongSignal).toBe(false);
    expect(r.confidence).toBeLessThanOrEqual(0.6);
  });

  it('scores an unrelated document near zero', () => {
    const r = scoreDocumentAgainstPo(doc({ vendor_name: 'Acme', total: 5 }), ctx, 'x@acme.com');
    expect(r.confidence).toBeLessThan(0.2);
  });
});

describe('buildGmailQueryForPo', () => {
  it('includes the PO number, order number, and vendor domain, excluding sent/drafts', () => {
    const q = buildGmailQueryForPo(ctx, 'GRAINGER');
    expect(q).toContain('"26-0027"');
    expect(q).toContain('"ORD-9"');
    expect(q).toContain('from:(grainger.com)');
    expect(q).toContain('-in:sent -in:drafts');
  });
});
