-- ============================================================================
-- Migration: Add GV term ID columns alongside existing freetext columns
-- Purpose: Enable GV term-based UOM, vendor type, and category references
-- Strategy: All new columns are NULLABLE — zero breaking changes
-- ============================================================================

-- 1. inventory.catalog_items — uom_term_id replaces unit_of_measure text
ALTER TABLE inventory.catalog_items
  ADD COLUMN IF NOT EXISTS uom_term_id UUID;

COMMENT ON COLUMN inventory.catalog_items.uom_term_id IS
  'GV term ID for unit of measure (domain: uom). Replaces freetext unit_of_measure.';

CREATE INDEX IF NOT EXISTS idx_catalog_items_tenant_uom_term
  ON inventory.catalog_items (tenant_id, uom_term_id)
  WHERE uom_term_id IS NOT NULL;

-- 2. inventory.item_categories — gv_category_term_id maps local category to GV item_category
ALTER TABLE inventory.item_categories
  ADD COLUMN IF NOT EXISTS gv_category_term_id UUID;

COMMENT ON COLUMN inventory.item_categories.gv_category_term_id IS
  'GV term ID mapping this local category to a GV item_category term (hybrid mapping).';

CREATE INDEX IF NOT EXISTS idx_item_categories_tenant_gv_term
  ON inventory.item_categories (tenant_id, gv_category_term_id)
  WHERE gv_category_term_id IS NOT NULL;

-- 3. supply_chain.vendors — vendor_type_term_id classifies vendor type
ALTER TABLE supply_chain.vendors
  ADD COLUMN IF NOT EXISTS vendor_type_term_id UUID;

COMMENT ON COLUMN supply_chain.vendors.vendor_type_term_id IS
  'GV term ID for vendor type classification (domain: vendor_type).';

CREATE INDEX IF NOT EXISTS idx_vendors_tenant_vendor_type_term
  ON supply_chain.vendors (tenant_id, vendor_type_term_id)
  WHERE vendor_type_term_id IS NOT NULL;

-- 4. inventory.locations — capacity_uom_term_id replaces capacity_uom text
ALTER TABLE inventory.locations
  ADD COLUMN IF NOT EXISTS capacity_uom_term_id UUID;

COMMENT ON COLUMN inventory.locations.capacity_uom_term_id IS
  'GV term ID for capacity unit of measure (domain: uom). Replaces freetext capacity_uom.';

CREATE INDEX IF NOT EXISTS idx_locations_tenant_capacity_uom_term
  ON inventory.locations (tenant_id, capacity_uom_term_id)
  WHERE capacity_uom_term_id IS NOT NULL;

-- 5. supply_chain.vendor_items — vendor_uom_term_id replaces vendor_uom text
ALTER TABLE supply_chain.vendor_items
  ADD COLUMN IF NOT EXISTS vendor_uom_term_id UUID;

COMMENT ON COLUMN supply_chain.vendor_items.vendor_uom_term_id IS
  'GV term ID for vendor unit of measure (domain: uom). Replaces freetext vendor_uom.';

CREATE INDEX IF NOT EXISTS idx_vendor_items_tenant_vendor_uom_term
  ON supply_chain.vendor_items (tenant_id, vendor_uom_term_id)
  WHERE vendor_uom_term_id IS NOT NULL;

-- 6. inventory.uom_conversions — from/to uom term IDs replace freetext
ALTER TABLE inventory.uom_conversions
  ADD COLUMN IF NOT EXISTS from_uom_term_id UUID;

ALTER TABLE inventory.uom_conversions
  ADD COLUMN IF NOT EXISTS to_uom_term_id UUID;

COMMENT ON COLUMN inventory.uom_conversions.from_uom_term_id IS
  'GV term ID for source unit of measure (domain: uom). Replaces freetext from_uom.';

COMMENT ON COLUMN inventory.uom_conversions.to_uom_term_id IS
  'GV term ID for target unit of measure (domain: uom). Replaces freetext to_uom.';

CREATE INDEX IF NOT EXISTS idx_uom_conversions_tenant_from_term
  ON inventory.uom_conversions (tenant_id, from_uom_term_id)
  WHERE from_uom_term_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_uom_conversions_tenant_to_term
  ON inventory.uom_conversions (tenant_id, to_uom_term_id)
  WHERE to_uom_term_id IS NOT NULL;

-- 7. supply_chain.purchase_order_lines — uom_term_id replaces unit_of_measure text
ALTER TABLE supply_chain.purchase_order_lines
  ADD COLUMN IF NOT EXISTS uom_term_id UUID;

COMMENT ON COLUMN supply_chain.purchase_order_lines.uom_term_id IS
  'GV term ID for unit of measure (domain: uom). Replaces freetext unit_of_measure.';

CREATE INDEX IF NOT EXISTS idx_po_lines_tenant_uom_term
  ON supply_chain.purchase_order_lines (tenant_id, uom_term_id)
  WHERE uom_term_id IS NOT NULL;
