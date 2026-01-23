-- ============================================================================
-- Add view for vendor_items with cross-schema catalog_items join
-- ============================================================================
-- Date: 2026-01-23
-- Purpose: Enable PostgREST to resolve cross-schema FK from supply_chain to inventory
-- ============================================================================

-- Create a view in supply_chain that includes the catalog_item relation
-- This allows PostgREST to follow the relationship without cross-schema issues
CREATE OR REPLACE VIEW supply_chain.vendor_items_with_catalog AS
SELECT 
    vi.*,
    ci.id as catalog_item_id_resolved,
    ci.sku as catalog_item_sku,
    ci.name as catalog_item_name,
    ci.description as catalog_item_description
FROM supply_chain.vendor_items vi
LEFT JOIN inventory.catalog_items ci ON ci.id = vi.catalog_item_id;

COMMENT ON VIEW supply_chain.vendor_items_with_catalog IS 
    'Vendor items with catalog item details - resolves cross-schema FK for PostgREST';

-- Grant access
GRANT SELECT ON supply_chain.vendor_items_with_catalog TO authenticated;
GRANT SELECT ON supply_chain.vendor_items_with_catalog TO anon;
