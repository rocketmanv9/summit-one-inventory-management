-- ============================================================================
-- Migration: Add material, product, and quality tier term ID columns
-- Purpose: Enable GV term-based material product & quality tier classification
-- Strategy: All new columns are NULLABLE — zero breaking changes
-- ============================================================================

-- 1. inventory.catalog_items — material_term_id, product_term_id, quality_tier_term_id
ALTER TABLE inventory.catalog_items
  ADD COLUMN IF NOT EXISTS material_term_id UUID,
  ADD COLUMN IF NOT EXISTS product_term_id UUID,
  ADD COLUMN IF NOT EXISTS quality_tier_term_id UUID;

COMMENT ON COLUMN inventory.catalog_items.material_term_id IS
  'GV term ID for material classification (domain: materials).';

COMMENT ON COLUMN inventory.catalog_items.product_term_id IS
  'GV term ID for product type (domain: material_product).';

COMMENT ON COLUMN inventory.catalog_items.quality_tier_term_id IS
  'GV term ID for quality tier (domain: quality_tier).';

-- Indexes following existing pattern from 20260519100001
CREATE INDEX IF NOT EXISTS idx_catalog_items_tenant_material_term
  ON inventory.catalog_items (tenant_id, material_term_id)
  WHERE material_term_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_catalog_items_tenant_product_term
  ON inventory.catalog_items (tenant_id, product_term_id)
  WHERE product_term_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_catalog_items_tenant_quality_tier_term
  ON inventory.catalog_items (tenant_id, quality_tier_term_id)
  WHERE quality_tier_term_id IS NOT NULL;
