-- =====================================================================
-- Migration: Enhance Receiving Workflow
-- Date: 2026-01-28
-- Description: Add missing columns for real-world receiving scenarios:
--   - Receipt status (draft/confirmed/cancelled)
--   - Vendor info and packing slip tracking
--   - Condition status for damaged/rejected items
--   - Line-level location splitting
--   - Over-delivery support
-- =====================================================================

-- =====================================================================
-- PART 1: ENHANCE RECEIPTS TABLE
-- =====================================================================

-- Add status tracking and vendor info to receipts
ALTER TABLE supply_chain.receipts 
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'confirmed',
  ADD COLUMN IF NOT EXISTS vendor_id UUID,
  ADD COLUMN IF NOT EXISTS packing_slip_no TEXT,
  ADD COLUMN IF NOT EXISTS vendor_invoice_no TEXT,
  ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'delivery';

-- Add foreign key constraint for vendor_id
ALTER TABLE supply_chain.receipts 
  ADD CONSTRAINT receipts_vendor_id_fkey 
    FOREIGN KEY (vendor_id) REFERENCES supply_chain.vendors(id) ON DELETE SET NULL;

-- Add check constraints
ALTER TABLE supply_chain.receipts 
  ADD CONSTRAINT receipts_status_check 
    CHECK (status IN ('draft', 'confirmed', 'cancelled'));

ALTER TABLE supply_chain.receipts 
  ADD CONSTRAINT receipts_source_type_check 
    CHECK (source_type IN ('delivery', 'pickup', 'transfer', 'return'));

-- Add indexes for new columns
CREATE INDEX IF NOT EXISTS idx_receipts_vendor_id 
  ON supply_chain.receipts(tenant_id, vendor_id) 
  WHERE vendor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_receipts_status 
  ON supply_chain.receipts(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_receipts_packing_slip 
  ON supply_chain.receipts(tenant_id, packing_slip_no) 
  WHERE packing_slip_no IS NOT NULL;

-- Comment on new columns
COMMENT ON COLUMN supply_chain.receipts.status IS 
  'Receipt status: draft (not posted), confirmed (posted to inventory), cancelled';

COMMENT ON COLUMN supply_chain.receipts.vendor_id IS 
  'Vendor for this receipt. Denormalized from PO or user-selected for quick receives.';

COMMENT ON COLUMN supply_chain.receipts.packing_slip_no IS 
  'Vendor packing slip number for matching and auditing';

COMMENT ON COLUMN supply_chain.receipts.vendor_invoice_no IS 
  'Vendor invoice number for expense matching';

COMMENT ON COLUMN supply_chain.receipts.source_type IS 
  'How items were received: delivery (vendor shipped), pickup (we picked up), transfer (internal), return (customer return)';

-- =====================================================================
-- PART 2: ENHANCE RECEIPT_LINES TABLE
-- =====================================================================

-- Add condition tracking and additional metadata to receipt_lines
ALTER TABLE supply_chain.receipt_lines
  ADD COLUMN IF NOT EXISTS condition_status TEXT NOT NULL DEFAULT 'accepted',
  ADD COLUMN IF NOT EXISTS destination_location_id UUID,
  ADD COLUMN IF NOT EXISTS unit_cost_actual NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS uom TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- Add foreign key for destination_location_id
ALTER TABLE supply_chain.receipt_lines
  ADD CONSTRAINT receipt_lines_destination_location_id_fkey 
    FOREIGN KEY (destination_location_id) REFERENCES inventory.locations(id) ON DELETE RESTRICT;

-- Add check constraint for condition_status
ALTER TABLE supply_chain.receipt_lines
  ADD CONSTRAINT receipt_lines_condition_check 
    CHECK (condition_status IN ('accepted', 'damaged', 'quarantine', 'rejected'));

-- Add index for non-standard conditions
CREATE INDEX IF NOT EXISTS idx_receipt_lines_condition 
  ON supply_chain.receipt_lines(tenant_id, condition_status)
  WHERE condition_status != 'accepted';

CREATE INDEX IF NOT EXISTS idx_receipt_lines_destination 
  ON supply_chain.receipt_lines(destination_location_id)
  WHERE destination_location_id IS NOT NULL;

-- Comment on new columns
COMMENT ON COLUMN supply_chain.receipt_lines.condition_status IS 
  'Condition of received items: accepted (good), damaged (usable but damaged), quarantine (needs inspection), rejected (not accepted)';

COMMENT ON COLUMN supply_chain.receipt_lines.destination_location_id IS 
  'Destination location for this line. If NULL, defaults to receipt.location_id. Enables line-level location splitting.';

COMMENT ON COLUMN supply_chain.receipt_lines.unit_cost_actual IS 
  'Actual unit cost from vendor invoice. May differ from PO estimate.';

COMMENT ON COLUMN supply_chain.receipt_lines.uom IS 
  'Unit of measure (denormalized from catalog_item for historical accuracy)';

-- =====================================================================
-- PART 3: RELAX OVER-DELIVERY CONSTRAINT
-- =====================================================================

-- Drop existing hard constraint that blocks over-delivery
ALTER TABLE supply_chain.purchase_order_lines 
  DROP CONSTRAINT IF EXISTS purchase_order_lines_qty_received_not_exceed;

ALTER TABLE supply_chain.purchase_order_lines 
  DROP CONSTRAINT IF EXISTS chk_po_line_quantities;

-- Add allow_over_delivery flag
ALTER TABLE supply_chain.purchase_order_lines
  ADD COLUMN IF NOT EXISTS allow_over_delivery BOOLEAN DEFAULT false;

-- Add soft constraint (can exceed if explicitly allowed)
ALTER TABLE supply_chain.purchase_order_lines
  ADD CONSTRAINT chk_po_line_quantities_with_override 
    CHECK (
      qty_received >= 0 
      AND qty_ordered > 0
      AND (allow_over_delivery = true OR qty_received <= qty_ordered)
    );

COMMENT ON COLUMN supply_chain.purchase_order_lines.allow_over_delivery IS 
  'If true, allows receiving more than ordered quantity. Used for approximate orders (e.g., gravel by the truckload).';

-- =====================================================================
-- PART 4: UPDATE TRIGGERS FOR NEW STATUS COLUMN
-- =====================================================================

-- Create trigger function to auto-populate vendor_id from PO
CREATE OR REPLACE FUNCTION supply_chain.auto_populate_receipt_vendor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = supply_chain, inventory, public
AS $$
BEGIN
  -- If po_id is provided and vendor_id is not, copy from PO
  IF NEW.po_id IS NOT NULL AND NEW.vendor_id IS NULL THEN
    SELECT vendor_id INTO NEW.vendor_id
    FROM supply_chain.purchase_orders
    WHERE id = NEW.po_id
      AND tenant_id = NEW.tenant_id;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Attach trigger to receipts table
DROP TRIGGER IF EXISTS trigger_auto_populate_vendor ON supply_chain.receipts;
CREATE TRIGGER trigger_auto_populate_vendor
  BEFORE INSERT OR UPDATE ON supply_chain.receipts
  FOR EACH ROW
  EXECUTE FUNCTION supply_chain.auto_populate_receipt_vendor();

COMMENT ON FUNCTION supply_chain.auto_populate_receipt_vendor() IS 
  'Auto-populates receipt.vendor_id from PO if not explicitly provided';

-- Create trigger function to auto-populate destination_location_id from receipt
CREATE OR REPLACE FUNCTION supply_chain.auto_populate_line_destination()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = supply_chain, inventory, public
AS $$
DECLARE
  v_receipt_location_id UUID;
BEGIN
  -- If destination_location_id is not set, default to receipt's location_id
  IF NEW.destination_location_id IS NULL THEN
    SELECT location_id INTO v_receipt_location_id
    FROM supply_chain.receipts
    WHERE id = NEW.receipt_id
      AND tenant_id = NEW.tenant_id;
    
    NEW.destination_location_id := v_receipt_location_id;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Attach trigger to receipt_lines table
DROP TRIGGER IF EXISTS trigger_auto_populate_destination ON supply_chain.receipt_lines;
CREATE TRIGGER trigger_auto_populate_destination
  BEFORE INSERT ON supply_chain.receipt_lines
  FOR EACH ROW
  EXECUTE FUNCTION supply_chain.auto_populate_line_destination();

COMMENT ON FUNCTION supply_chain.auto_populate_line_destination() IS 
  'Auto-populates receipt_line.destination_location_id from receipt.location_id if not specified';

-- =====================================================================
-- PART 5: UPDATE RLS POLICIES (if needed)
-- =====================================================================

-- RLS policies on receipts and receipt_lines already filter by tenant_id
-- New columns inherit existing policies automatically
-- No changes needed

-- =====================================================================
-- PART 6: MIGRATION VALIDATION
-- =====================================================================

-- Validate all existing receipts have valid status
UPDATE supply_chain.receipts
SET status = 'confirmed'
WHERE status IS NULL OR status NOT IN ('draft', 'confirmed', 'cancelled');

-- Validate all existing receipt_lines have valid condition
UPDATE supply_chain.receipt_lines
SET condition_status = 'accepted'
WHERE condition_status IS NULL OR condition_status NOT IN ('accepted', 'damaged', 'quarantine', 'rejected');

-- =====================================================================
-- PART 7: SEED REFERENCE DATA (OPTIONAL)
-- =====================================================================

-- Add descriptions for new enums (for documentation/UI)
-- These can be stored in a reference table or just as comments

COMMENT ON TABLE supply_chain.receipts IS 
  'Receipt header records. Tracks physical receipt of items from vendors or other sources.
  
  Status values:
  - draft: Receipt created but not yet confirmed/posted to inventory
  - confirmed: Receipt posted to inventory (stock balances updated)
  - cancelled: Receipt cancelled, no inventory impact
  
  Source types:
  - delivery: Vendor delivered items to our location
  - pickup: We picked up items from vendor location
  - transfer: Internal transfer between locations
  - return: Customer/job return';

COMMENT ON TABLE supply_chain.receipt_lines IS 
  'Receipt line items. Individual catalog items received.
  
  Condition status values:
  - accepted: Items in good condition, added to available inventory
  - damaged: Items damaged but may be usable, flagged for inspection
  - quarantine: Items requiring inspection before release
  - rejected: Items not accepted, not added to inventory (return to vendor)';

-- =====================================================================
-- END OF MIGRATION
-- =====================================================================
