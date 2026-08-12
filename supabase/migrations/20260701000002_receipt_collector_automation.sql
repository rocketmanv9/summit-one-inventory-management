-- ============================================================================
-- Intelligent Receipt Collector — automation state
--
-- Per-PO bookkeeping for the background collection cron: when we last swept
-- Gmail for a PO's documents, and whether collection is "complete" (invoice /
-- receipt found and the order has arrived) so the cron can stop polling it.
-- ============================================================================

ALTER TABLE supply_chain.purchase_orders
  ADD COLUMN IF NOT EXISTS docs_last_collected_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS docs_collection_complete BOOLEAN NOT NULL DEFAULT false;

-- Cron selection: open POs not yet complete, oldest-swept first.
CREATE INDEX IF NOT EXISTS idx_purchase_orders_doc_collection
  ON supply_chain.purchase_orders (tenant_id, docs_collection_complete, docs_last_collected_at);
