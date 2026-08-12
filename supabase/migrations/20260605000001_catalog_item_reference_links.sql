-- ============================================================================
-- Reference links on catalog items
-- Free-form list of { label, url } links attached to an item (product pages,
-- spec sheets, supplier portals). Distinct from the Amazon/vendor_items mapping
-- system — these are plain reference URLs, not orderable vendor SKUs.
-- ============================================================================

ALTER TABLE inventory.catalog_items
  ADD COLUMN IF NOT EXISTS reference_links jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN inventory.catalog_items.reference_links IS
  'Array of { label: text, url: text } reference links for this item (product pages, spec sheets, supplier portals).';
