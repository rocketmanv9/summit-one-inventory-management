-- ==========================================
-- Migration: Cleanup Catalog Items UOM Columns
-- Date: 2026-01-22
-- Purpose: Remove duplicate and unused UOM columns
-- ==========================================

-- Drop unused multi-UOM columns (never populated or used in code)
ALTER TABLE inventory.catalog_items DROP COLUMN IF EXISTS base_uom;
ALTER TABLE inventory.catalog_items DROP COLUMN IF EXISTS purch_uom;
ALTER TABLE inventory.catalog_items DROP COLUMN IF EXISTS issue_uom;

-- Drop duplicate UOM columns (unit_of_measure is the standard)
ALTER TABLE inventory.catalog_items DROP COLUMN IF EXISTS uom;
ALTER TABLE inventory.catalog_items DROP COLUMN IF EXISTS unit;

-- Add comment to document the standard UOM column
COMMENT ON COLUMN inventory.catalog_items.unit_of_measure IS 'Standard unit of measure for this item (e.g., EA, BOX, PALLET)';
