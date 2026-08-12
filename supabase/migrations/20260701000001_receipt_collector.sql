-- ============================================================================
-- Intelligent Receipt Collector — foundation slice
--
-- Adds the permanent "receipt repository" for purchasing documents (receipts,
-- invoices, order confirmations, shipping/delivery notices, packing slips,
-- credit memos, warranty docs), a private storage bucket for the original
-- files, per-vendor known email-domains for sender matching, and a
-- confidence-gated reconciliation RPC that writes a matched document's real
-- numbers back onto the PO (line costs + vendor order #), records an
-- accounting expense, and leaves a full audit trail in procurement_events.
--
-- Provider-agnostic by design: `source` is free-form so Gmail today and
-- Outlook / carrier / Amazon / bank-feed sources later all land in one table.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Private storage bucket for original documents (NOT public — receipts are
--    sensitive; access is via short-lived signed URLs from the read route).
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('purchase-documents', 'purchase-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Tenant-folder RLS on storage.objects: path is `{tenantId}/...`.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='objects' AND policyname='purchase_documents_tenant_select') THEN
    CREATE POLICY purchase_documents_tenant_select ON storage.objects
      FOR SELECT TO authenticated
      USING (
        bucket_id = 'purchase-documents'
        AND (storage.foldername(name))[1] = (current_setting('request.jwt.claims', true)::json->>'tenant_id')
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='objects' AND policyname='purchase_documents_tenant_insert') THEN
    CREATE POLICY purchase_documents_tenant_insert ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'purchase-documents'
        AND (storage.foldername(name))[1] = (current_setting('request.jwt.claims', true)::json->>'tenant_id')
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='objects' AND policyname='purchase_documents_tenant_update') THEN
    CREATE POLICY purchase_documents_tenant_update ON storage.objects
      FOR UPDATE TO authenticated
      USING (
        bucket_id = 'purchase-documents'
        AND (storage.foldername(name))[1] = (current_setting('request.jwt.claims', true)::json->>'tenant_id')
      )
      WITH CHECK (
        bucket_id = 'purchase-documents'
        AND (storage.foldername(name))[1] = (current_setting('request.jwt.claims', true)::json->>'tenant_id')
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='objects' AND policyname='purchase_documents_tenant_delete') THEN
    CREATE POLICY purchase_documents_tenant_delete ON storage.objects
      FOR DELETE TO authenticated
      USING (
        bucket_id = 'purchase-documents'
        AND (storage.foldername(name))[1] = (current_setting('request.jwt.claims', true)::json->>'tenant_id')
      );
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. purchase_documents — the receipt repository (one row per collected doc)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS supply_chain.purchase_documents (
  id                       UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id                UUID NOT NULL,

  -- Purchase linkage (nullable until matched)
  purchase_order_id        UUID REFERENCES supply_chain.purchase_orders(id) ON DELETE SET NULL,

  -- Classification
  doc_type                 TEXT NOT NULL DEFAULT 'other'
    CHECK (doc_type IN ('order_confirmation','receipt','invoice','shipping_notification',
                        'delivery_confirmation','packing_slip','credit_memo','warranty','other')),

  -- Provenance (provider-agnostic; gmail | upload | webhook | amazon | outlook | bank_feed | manual …)
  source                   TEXT NOT NULL DEFAULT 'gmail',
  source_ref               TEXT,            -- gmail message id / external id
  source_attachment_id     TEXT,            -- gmail attachment id (null for email-body/html docs)
  sender_email             TEXT,
  subject                  TEXT,
  document_date            DATE,            -- date printed on / received for the document

  -- Stored original
  storage_path             TEXT,            -- {tenantId}/{poId|unmatched}/{id}.{ext}; null while pending
  file_name                TEXT,
  content_type             TEXT,
  byte_size                BIGINT,
  content_hash             TEXT,            -- sha256 of bytes, for de-duplication

  -- Extracted structured data (OCR/vision/text)
  vendor_id                UUID REFERENCES supply_chain.vendors(id) ON DELETE SET NULL,
  vendor_name              TEXT,
  po_number_detected       TEXT,
  order_number             TEXT,            -- vendor's external order #
  invoice_number           TEXT,
  receipt_number           TEXT,
  tracking_numbers         TEXT[] NOT NULL DEFAULT '{}',
  subtotal                 NUMERIC(18,4),
  tax                      NUMERIC(18,4),
  shipping                 NUMERIC(18,4),
  total                    NUMERIC(18,4),
  currency                 TEXT DEFAULT 'USD',
  payment_method           TEXT,
  store_number             TEXT,
  line_items               JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{description, sku, qty, unit_price, amount}]
  extracted                JSONB NOT NULL DEFAULT '{}'::jsonb,  -- full extractor output incl. confidence + raw text

  extraction_status        TEXT NOT NULL DEFAULT 'pending'
    CHECK (extraction_status IN ('pending','extracted','failed','unsupported')),
  extraction_error         TEXT,

  -- Matching
  match_status             TEXT NOT NULL DEFAULT 'unmatched'
    CHECK (match_status IN ('unmatched','suggested','matched','dismissed','superseded')),
  match_confidence         NUMERIC(4,3),
  match_signals            JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {po_number:1, tracking:1, total:0.5, ...} for explainability
  matched_at               TIMESTAMPTZ,
  matched_by_user_id       UUID,

  -- Reconciliation (writing the doc's numbers back onto the PO)
  reconciled_at            TIMESTAMPTZ,
  reconciled_by_user_id    UUID,

  -- A later, better document (e.g. invoice replacing an order confirmation)
  superseded_by_document_id UUID REFERENCES supply_chain.purchase_documents(id) ON DELETE SET NULL,

  last_event_id            TEXT NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_purchase_documents_event UNIQUE (tenant_id, last_event_id)
);

-- De-dupe the same Gmail attachment / body across repeated collection runs.
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_documents_source
  ON supply_chain.purchase_documents (tenant_id, source, source_ref, source_attachment_id)
  NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_purchase_documents_tenant       ON supply_chain.purchase_documents (tenant_id);
CREATE INDEX IF NOT EXISTS idx_purchase_documents_po           ON supply_chain.purchase_documents (tenant_id, purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_documents_match_status ON supply_chain.purchase_documents (tenant_id, match_status);
CREATE INDEX IF NOT EXISTS idx_purchase_documents_vendor       ON supply_chain.purchase_documents (tenant_id, vendor_id);
CREATE INDEX IF NOT EXISTS idx_purchase_documents_tracking     ON supply_chain.purchase_documents USING GIN (tracking_numbers);
-- Identifier lookups (search-by-invoice / order / po). Btree covers exact +
-- prefix; a pg_trgm fuzzy upgrade can be layered on later once the extension
-- is enabled on this environment.
CREATE INDEX IF NOT EXISTS idx_purchase_documents_invoice ON supply_chain.purchase_documents (tenant_id, invoice_number);
CREATE INDEX IF NOT EXISTS idx_purchase_documents_order   ON supply_chain.purchase_documents (tenant_id, order_number);
CREATE INDEX IF NOT EXISTS idx_purchase_documents_ponum   ON supply_chain.purchase_documents (tenant_id, po_number_detected);

ALTER TABLE supply_chain.purchase_documents ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='purchase_documents' AND policyname='purchase_documents_service_role_all') THEN
    CREATE POLICY purchase_documents_service_role_all ON supply_chain.purchase_documents
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='purchase_documents' AND policyname='purchase_documents_tenant_select') THEN
    CREATE POLICY purchase_documents_tenant_select ON supply_chain.purchase_documents
      FOR SELECT TO authenticated
      USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='purchase_documents' AND policyname='purchase_documents_tenant_insert') THEN
    CREATE POLICY purchase_documents_tenant_insert ON supply_chain.purchase_documents
      FOR INSERT TO authenticated
      WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='purchase_documents' AND policyname='purchase_documents_tenant_update') THEN
    CREATE POLICY purchase_documents_tenant_update ON supply_chain.purchase_documents
      FOR UPDATE TO authenticated
      USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid)
      WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='purchase_documents' AND policyname='purchase_documents_tenant_delete') THEN
    CREATE POLICY purchase_documents_tenant_delete ON supply_chain.purchase_documents
      FOR DELETE TO authenticated
      USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3. vendor_email_domains — per-vendor known sender domains (matching + parser
--    routing). Seeded from vendor emails; curatable and extensible by parsers.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS supply_chain.vendor_email_domains (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   UUID NOT NULL,
  vendor_id   UUID NOT NULL REFERENCES supply_chain.vendors(id) ON DELETE CASCADE,
  domain      TEXT NOT NULL,                       -- lowercased, e.g. 'grainger.com'
  source      TEXT NOT NULL DEFAULT 'derived'      -- derived | manual | parser
    CHECK (source IN ('derived','manual','parser')),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_vendor_email_domains UNIQUE (tenant_id, vendor_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_vendor_email_domains_lookup ON supply_chain.vendor_email_domains (tenant_id, domain) WHERE is_active;

ALTER TABLE supply_chain.vendor_email_domains ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='vendor_email_domains' AND policyname='vendor_email_domains_service_role_all') THEN
    CREATE POLICY vendor_email_domains_service_role_all ON supply_chain.vendor_email_domains
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='vendor_email_domains' AND policyname='vendor_email_domains_tenant_select') THEN
    CREATE POLICY vendor_email_domains_tenant_select ON supply_chain.vendor_email_domains
      FOR SELECT TO authenticated
      USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='vendor_email_domains' AND policyname='vendor_email_domains_tenant_write') THEN
    CREATE POLICY vendor_email_domains_tenant_write ON supply_chain.vendor_email_domains
      FOR ALL TO authenticated
      USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid)
      WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
  END IF;
END $$;

-- Seed domains from existing vendor emails (contact_email + po_email).
INSERT INTO supply_chain.vendor_email_domains (tenant_id, vendor_id, domain, source)
SELECT DISTINCT v.tenant_id, v.id,
       lower(split_part(email, '@', 2)) AS domain,
       'derived'
FROM supply_chain.vendors v
CROSS JOIN LATERAL (VALUES (v.contact_email), (v.po_email)) AS e(email)
WHERE e.email IS NOT NULL
  AND position('@' IN e.email) > 0
  AND lower(split_part(e.email, '@', 2)) NOT IN
      ('gmail.com','yahoo.com','hotmail.com','outlook.com','aol.com','icloud.com','me.com','live.com')
ON CONFLICT (tenant_id, vendor_id, domain) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 4. rpc_reconcile_po_from_document — apply a matched document's actuals onto
--    the PO (line unit costs + vendor order #), record an accounting expense,
--    attach the doc reference to the PO, and audit everything. Idempotent.
--
--    Line mapping is resolved in the application layer (where the extracted
--    line items and PO lines are both available) and passed in as
--    p_line_updates = [{po_line_id, unit_cost}]; the RPC only applies the
--    resolved updates transactionally so the write is auditable and reversible.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION supply_chain.rpc_reconcile_po_from_document(
  p_tenant_id    UUID,
  p_document_id  UUID,
  p_line_updates JSONB DEFAULT '[]'::jsonb,   -- [{"po_line_id": uuid, "unit_cost": number}]
  p_header       JSONB DEFAULT '{}'::jsonb,   -- {"external_order_number": text, "expected_delivery_date": date}
  p_expense      JSONB DEFAULT '{}'::jsonb,   -- {"amount": number, "tax": number, "invoice_number": text, "receipt_url": text, "expense_date": date}
  p_actor        UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'supply_chain', 'public'
AS $$
DECLARE
  v_doc          supply_chain.purchase_documents%ROWTYPE;
  v_po           supply_chain.purchase_orders%ROWTYPE;
  v_before       JSONB;
  v_after        JSONB;
  v_upd          JSONB;
  v_line_id      UUID;
  v_new_cost     NUMERIC;
  v_updated      INT := 0;
  v_ext_order    TEXT;
  v_exp_date     DATE;
  v_total_before NUMERIC;
  v_total_after  NUMERIC;
  v_event_id     TEXT;
BEGIN
  SELECT * INTO v_doc FROM supply_chain.purchase_documents
    WHERE id = p_document_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document % not found for tenant', p_document_id USING ERRCODE = 'no_data_found';
  END IF;
  IF v_doc.purchase_order_id IS NULL THEN
    RAISE EXCEPTION 'Document % is not matched to a purchase order', p_document_id USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_po FROM supply_chain.purchase_orders
    WHERE id = v_doc.purchase_order_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order % not found for tenant', v_doc.purchase_order_id USING ERRCODE = 'no_data_found';
  END IF;

  -- Snapshot BEFORE (for audit + reversibility).
  SELECT COALESCE(sum(qty_ordered * COALESCE(unit_cost, estimated_unit_cost, 0)), 0)
    INTO v_total_before
    FROM supply_chain.purchase_order_lines WHERE po_id = v_po.id AND tenant_id = p_tenant_id;

  SELECT jsonb_build_object(
           'external_order_number', v_po.external_order_number,
           'expected_delivery_date', v_po.expected_delivery_date,
           'total', v_total_before,
           'lines', COALESCE(jsonb_agg(jsonb_build_object('po_line_id', l.id, 'unit_cost', l.unit_cost)), '[]'::jsonb)
         )
    INTO v_before
    FROM supply_chain.purchase_order_lines l WHERE l.po_id = v_po.id AND l.tenant_id = p_tenant_id;

  -- Apply resolved per-line actual unit costs.
  FOR v_upd IN SELECT * FROM jsonb_array_elements(COALESCE(p_line_updates, '[]'::jsonb))
  LOOP
    v_line_id  := NULLIF(v_upd->>'po_line_id','')::uuid;
    v_new_cost := NULLIF(v_upd->>'unit_cost','')::numeric;
    IF v_line_id IS NULL OR v_new_cost IS NULL THEN CONTINUE; END IF;

    UPDATE supply_chain.purchase_order_lines
       SET unit_cost   = v_new_cost,
           price_basis = 'fixed',
           updated_at  = now(),
           updated_by  = p_actor
     WHERE id = v_line_id AND po_id = v_po.id AND tenant_id = p_tenant_id;
    IF FOUND THEN v_updated := v_updated + 1; END IF;
  END LOOP;

  -- Header: only FILL an empty vendor order #; optionally set expected delivery.
  v_ext_order := NULLIF(p_header->>'external_order_number','');
  v_exp_date  := NULLIF(p_header->>'expected_delivery_date','')::date;

  UPDATE supply_chain.purchase_orders
     SET external_order_number  = COALESCE(external_order_number, v_ext_order),
         expected_delivery_date = COALESCE(v_exp_date, expected_delivery_date),
         -- Attach a compact reference so the PO record itself carries its docs.
         attachments = COALESCE(attachments, '[]'::jsonb) || jsonb_build_object(
             'document_id', v_doc.id,
             'doc_type',    v_doc.doc_type,
             'file_name',   v_doc.file_name,
             'storage_path', v_doc.storage_path,
             'invoice_number', v_doc.invoice_number,
             'attached_at', now()
         ),
         updated_at = now(),
         updated_by = p_actor
   WHERE id = v_po.id AND tenant_id = p_tenant_id;

  SELECT COALESCE(sum(qty_ordered * COALESCE(unit_cost, estimated_unit_cost, 0)), 0)
    INTO v_total_after
    FROM supply_chain.purchase_order_lines WHERE po_id = v_po.id AND tenant_id = p_tenant_id;

  v_after := jsonb_build_object(
    'external_order_number', COALESCE(v_po.external_order_number, v_ext_order),
    'expected_delivery_date', COALESCE(v_exp_date, v_po.expected_delivery_date),
    'total', v_total_after,
    'lines_updated', v_updated
  );

  -- Record a (non-authoritative) accounting expense keyed to this document.
  v_event_id := 'doc_expense_' || v_doc.id::text;
  INSERT INTO supply_chain.accounting_expenses (
    tenant_id, vendor_id, po_id, expense_date, amount, currency, status,
    receipt_url, invoice_number, description, matched_at, last_event_id
  ) VALUES (
    p_tenant_id, v_doc.vendor_id, v_po.id,
    COALESCE(NULLIF(p_expense->>'expense_date','')::date, v_doc.document_date, CURRENT_DATE),
    COALESCE(NULLIF(p_expense->>'amount','')::numeric, v_doc.total, 0),
    COALESCE(v_doc.currency, 'USD'), 'matched',
    NULLIF(p_expense->>'receipt_url',''),
    COALESCE(NULLIF(p_expense->>'invoice_number',''), v_doc.invoice_number),
    'Reconciled from ' || v_doc.doc_type || ' (' || COALESCE(v_doc.file_name,'document') || ')',
    now(), v_event_id
  )
  ON CONFLICT (tenant_id, last_event_id) DO UPDATE
    SET amount = EXCLUDED.amount, invoice_number = EXCLUDED.invoice_number,
        receipt_url = EXCLUDED.receipt_url, matched_at = EXCLUDED.matched_at,
        status = 'matched', updated_at = now();

  -- Audit ledger entry (immutable).
  v_event_id := 'recon_' || v_doc.id::text;
  INSERT INTO supply_chain.procurement_events (
    tenant_id, event_type, po_id, actor_user_id, source_system, last_event_id, payload
  ) VALUES (
    p_tenant_id, 'invoice_matched', v_po.id, p_actor, 'receipt_collector', v_event_id,
    jsonb_build_object(
      'document_id',   v_doc.id,
      'doc_type',      v_doc.doc_type,
      'source',        v_doc.source,
      'confidence',    v_doc.match_confidence,
      'invoice_number', v_doc.invoice_number,
      'before',        v_before,
      'after',         v_after
    )
  )
  ON CONFLICT (tenant_id, last_event_id) DO UPDATE SET payload = EXCLUDED.payload;

  -- Mark the document reconciled.
  UPDATE supply_chain.purchase_documents
     SET match_status = 'matched',
         reconciled_at = now(),
         reconciled_by_user_id = p_actor,
         updated_at = now()
   WHERE id = v_doc.id AND tenant_id = p_tenant_id;

  RETURN jsonb_build_object(
    'success', true,
    'purchase_order_id', v_po.id,
    'lines_updated', v_updated,
    'total_before', v_total_before,
    'total_after', v_total_after,
    'before', v_before,
    'after', v_after
  );
END;
$$;

GRANT EXECUTE ON FUNCTION supply_chain.rpc_reconcile_po_from_document(UUID, UUID, JSONB, JSONB, JSONB, UUID) TO authenticated, service_role;
