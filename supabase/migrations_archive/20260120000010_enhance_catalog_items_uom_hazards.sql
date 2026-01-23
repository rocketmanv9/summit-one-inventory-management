-- ============================================================================
-- PHASE 2: CATALOG ENHANCEMENTS - UOM & Hazards
-- ============================================================================
-- Adds unit of measure tracking and hazard flags to catalog items

-- Add new columns
ALTER TABLE inventory.catalog_items
ADD COLUMN IF NOT EXISTS base_uom TEXT NULL,
ADD COLUMN IF NOT EXISTS purch_uom TEXT NULL,
ADD COLUMN IF NOT EXISTS issue_uom TEXT NULL,
ADD COLUMN IF NOT EXISTS barcode TEXT NULL,
ADD COLUMN IF NOT EXISTS hazard_flags JSONB NULL DEFAULT '{}';

-- Comments
COMMENT ON COLUMN inventory.catalog_items.base_uom IS 'Base unit of measure (stock keeping unit): EA, GAL, FT, LB, etc.';
COMMENT ON COLUMN inventory.catalog_items.purch_uom IS 'Purchasing unit of measure (may differ from base)';
COMMENT ON COLUMN inventory.catalog_items.issue_uom IS 'Issue/consumption unit of measure';
COMMENT ON COLUMN inventory.catalog_items.barcode IS 'Barcode/UPC for scanning';
COMMENT ON COLUMN inventory.catalog_items.hazard_flags IS 'Hazard classifications: {"flammable": true, "corrosive": false, "dot_class": "3"}';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_catalog_items_barcode 
    ON inventory.catalog_items(tenant_id, barcode) 
    WHERE barcode IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_catalog_items_hazard_flags 
    ON inventory.catalog_items USING GIN (hazard_flags) 
    WHERE hazard_flags IS NOT NULL AND hazard_flags != '{}';

CREATE INDEX IF NOT EXISTS idx_catalog_items_base_uom 
    ON inventory.catalog_items(tenant_id, base_uom) 
    WHERE base_uom IS NOT NULL;

-- Unique constraint on barcode (if present)
CREATE UNIQUE INDEX IF NOT EXISTS catalog_items_tenant_barcode_unique 
    ON inventory.catalog_items(tenant_id, barcode) 
    WHERE barcode IS NOT NULL;

-- Helper function to check if item is hazardous
CREATE OR REPLACE FUNCTION inventory.is_hazardous(p_catalog_item_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_hazard_flags JSONB;
    v_key TEXT;
BEGIN
    SELECT hazard_flags INTO v_hazard_flags
    FROM inventory.catalog_items
    WHERE id = p_catalog_item_id;
    
    IF v_hazard_flags IS NULL OR v_hazard_flags = '{}' THEN
        RETURN FALSE;
    END IF;
    
    -- Check if any hazard flag is true
    FOR v_key IN SELECT jsonb_object_keys(v_hazard_flags)
    LOOP
        IF (v_hazard_flags->>v_key)::BOOLEAN = TRUE THEN
            RETURN TRUE;
        END IF;
    END LOOP;
    
    RETURN FALSE;
END;
$$;

COMMENT ON FUNCTION inventory.is_hazardous IS 
    'Returns true if catalog item has any hazard flags set to true';

DO $$ BEGIN
    RAISE NOTICE '✅ Catalog items enhanced with UOM and hazard tracking';
END $$;

