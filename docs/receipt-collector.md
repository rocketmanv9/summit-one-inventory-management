# Intelligent Receipt Collector

Automatically collects supporting documentation for purchase orders — receipts,
invoices, order confirmations, shipping/delivery notices, packing slips, credit
memos, warranty docs — associates each with the right PO by confidence, and
writes the invoiced actuals back onto the PO so the PO on file (and its
generated PDF) reflects reality.

## Architecture

The pipeline is layered so each stage can be swapped or extended in isolation.
Nothing above the source layer knows about Gmail; nothing below the matching
layer knows about purchase orders.

```
DocumentSource   → RawDocument[]        src/lib/documents/sources/
    Gmail today; Outlook, carrier APIs, Amazon Business, bank/expense feeds later
DocumentExtractor → ExtractedDocument   src/lib/documents/extraction/
    provider-agnostic OCR: OpenAI vision + text-first PDF (pdfjs) + heuristic
VendorParser      → refined doc         src/lib/documents/vendors/registry.ts
    per-vendor rules (Amazon, Grainger, Home Depot, …) — add without touching core
matching engine   → confidence 0..1     src/lib/documents/matching/engine.ts
    pure, unit-tested; PO#, order#, tracking#, vendor domain, total, date
store.ts          → orchestration       src/lib/documents/store.ts
    collect → extract → parse → score → persist → (auto-)reconcile
```

### Data model (`supply_chain`)

- `purchase_documents` — the permanent receipt repository (original + extracted
  data + match/reconcile state + audit). One row per collected document.
- `vendor_email_domains` — per-vendor known sender domains (seeded from vendor
  emails; used for sender matching + parser routing).
- `purchase-documents` storage bucket — **private**; originals are served via
  short-lived signed URLs.
- `rpc_reconcile_po_from_document(...)` — writes line actual costs + vendor
  order # onto the PO, records an `accounting_expenses` row, attaches the
  document to the PO, and audits before/after into `procurement_events`
  (`event_type = 'invoice_matched'`). Idempotent and reversible.
- `purchase_orders.docs_last_collected_at` / `docs_collection_complete` — cron
  bookkeeping.

### Confidence gating

- **≥ 0.95** → auto-attach + reconcile (invoices/receipts). Requires a strong
  identifier (PO#, vendor order#, or tracking#) plus corroboration.
- **0.70–0.94** → attached and surfaced as a review suggestion.
- **< 0.70** → stored but left unmatched.

Manual uploads are held at "review" (never auto-reconciled) so a human action is
always required before a manually-attached file rewrites a PO.

### Automation

`GET /api/system/cron/collect-documents` (CRON_SECRET-gated, every 3h) fans out
across tenants with a Gmail connection, sweeps each open PO's documents, and
auto-reconciles high-confidence invoices/receipts. A PO stops being swept once a
financial document is on file **and** the goods have arrived (received status or
a delivered shipment). A later, higher-rank document (an invoice) supersedes an
earlier lower-rank one (the order confirmation).

## Extending to new providers

Implement `DocumentSource.search()` to return `RawDocument[]`; everything
downstream is reused. Set `RawDocument.source` to a stable provider name (it is
stored on each document and is free-form by design).

### Bank of America Spend Management (and other expense platforms)

Kept **provider-agnostic** — BofA is one possible source/sink, not hardcoded.
See `src/lib/documents/sources/spend-management-source.ts` for the stub.

Two complementary integration modes, both fitting the existing pipeline:

1. **As a `DocumentSource` (pull).** BofA's commercial-card / Global Card Access
   + Spend Management platform exposes card transactions and, for programs with
   receipt imaging, associated receipt images. A source would pull recent
   transactions/receipts, download each image/PDF, and emit `RawDocument`s with
   `source = 'bofa_spend'`. The matching engine then ties each to a PO by amount
   + date + vendor (card transactions rarely carry a PO#, so these typically
   land as 0.70–0.94 review suggestions rather than auto-reconcile) and the
   cardholder resolves via `hr_people.work_email`.

2. **As a sink (push).** Because we already store the original receipt for every
   PO, we can *push* those images back to BofA's receipt store to satisfy
   card-program receipt-capture requirements — a `DocumentSink` interface
   (future) mirroring `DocumentSource`.

Availability of a given API depends on the customer's BofA program enrollment;
the seam is designed so enabling it is configuration + one `DocumentSource`
implementation, with no change to extraction, matching, storage, or
reconciliation.

Other future sources that drop into the same seam: Outlook/Microsoft Graph,
carrier APIs (FedEx/UPS/USPS) for delivery confirmation, Amazon Business /
Grainger / Uline order APIs, and general accounting systems.
