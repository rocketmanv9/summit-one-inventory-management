-- Migration: Add Validation Constraints
-- Purpose: Enforce data integrity rules across inventory tables
-- Phase: 2 (Short-term improvements)

-- Set search path to inventory schema
SET search_path TO inventory, public;

-- ============================================================================
-- 1. Add CHECK constraint on reservations.allocation_type
-- ============================================================================
-- Prevents typos and invalid allocation types
-- Note: Already exists with constraint chk_allocation_type
-- Skip - already applied

-- ============================================================================
-- 2. Prevent PO lines for inactive catalog items
-- ============================================================================
CREATE OR REPLACE FUNCTION inventory.validate_catalog_item_active()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_is_active BOOLEAN;
  v_item_sku TEXT;
BEGIN
  -- Check if catalog item is active
  SELECT active, sku INTO v_is_active, v_item_sku
  FROM inventory.catalog_items
  WHERE id = NEW.catalog_item_id;

  IF NOT v_is_active THEN
    RAISE EXCEPTION 'Cannot create PO line for inactive item: % (SKU: %)', 
      NEW.catalog_item_id, v_item_sku
    USING HINT = 'Reactivate the catalog item before adding to purchase orders';
  END IF;

  RETURN NEW;
END;
$$;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS validate_catalog_item_active_trigger ON inventory.purchase_order_lines;

CREATE TRIGGER validate_catalog_item_active_trigger
  BEFORE INSERT OR UPDATE OF catalog_item_id ON inventory.purchase_order_lines
  FOR EACH ROW
  EXECUTE FUNCTION inventory.validate_catalog_item_active();

COMMENT ON FUNCTION inventory.validate_catalog_item_active() IS 
  'Prevents PO lines from being created for inactive catalog items';

-- ============================================================================
-- 3. Add CHECK constraint on stock_movements.quantity_delta
-- ============================================================================
-- Prevent zero-quantity movements (data quality issue)
ALTER TABLE inventory.stock_movements
  DROP CONSTRAINT IF EXISTS chk_quantity_delta_not_zero;

ALTER TABLE inventory.stock_movements
  ADD CONSTRAINT chk_quantity_delta_not_zero
  CHECK (quantity_delta != 0);

COMMENT ON CONSTRAINT chk_quantity_delta_not_zero ON inventory.stock_movements IS 
  'Prevents meaningless movements with zero quantity delta';

-- ============================================================================
-- 4. Add CHECK constraint on purchase_order_lines quantities
-- ============================================================================
-- Ensure PO line quantities are valid
ALTER TABLE inventory.purchase_order_lines
  DROP CONSTRAINT IF EXISTS chk_po_line_quantities;

ALTER TABLE inventory.purchase_order_lines
  ADD CONSTRAINT chk_po_line_quantities
  CHECK (
    qty_ordered > 0
    AND qty_received >= 0
    AND qty_received <= qty_ordered  -- Cannot receive more than ordered
  );

COMMENT ON CONSTRAINT chk_po_line_quantities ON inventory.purchase_order_lines IS 
  'Validates PO line quantities: ordered must be positive, received cannot exceed ordered';

-- ============================================================================
-- 5. Add CHECK constraint on reservations quantities
-- ============================================================================
-- Ensure reservation quantities are valid (using 'qty' column)
ALTER TABLE inventory.reservations
  DROP CONSTRAINT IF EXISTS chk_reservation_qty_positive;

ALTER TABLE inventory.reservations
  ADD CONSTRAINT chk_reservation_qty_positive
  CHECK (qty > 0);

COMMENT ON CONSTRAINT chk_reservation_qty_positive ON inventory.reservations IS 
  'Validates reservation quantity must be positive';

-- ============================================================================
-- Success confirmation
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Migration 20260120000083 completed successfully';
  RAISE NOTICE '✓ Skipped reservations.allocation_type (already exists)';
  RAISE NOTICE '✓ Added trigger to prevent PO lines for inactive items';
  RAISE NOTICE '✓ Added CHECK constraint on stock_movements.quantity_delta';
  RAISE NOTICE '✓ Added CHECK constraint on purchase_order_lines quantities';
  RAISE NOTICE '✓ Added CHECK constraint on reservations.qty';
END $$;

