-- =====================================================
-- VERIFY AND ALIGN INVENTORY QUANTITIES & STATUSES
-- =====================================================
-- This migration ensures the database accurately implements:
-- 1. Four core quantities (on_hand, reserved, available, on_order)
-- 2. Correct statuses per entity type
-- 3. No anti-patterns (no single "status" column on inventory)

-- =====================================================
-- 1. UPDATE CATALOG ITEMS - ADD STATUS FIELD
-- =====================================================
-- Catalog items track: active, inactive, deprecated, seasonal
-- This is MASTER DATA status, not inventory quantity status

DO $$ 
BEGIN
    -- Check if we need to add a status column or if active boolean is enough
    -- We'll keep 'active' boolean and add flags for more granular control
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'inventory' 
        AND table_name = 'catalog_items' 
        AND column_name = 'deprecated'
    ) THEN
        ALTER TABLE inventory.catalog_items
        ADD COLUMN deprecated BOOLEAN DEFAULT FALSE,
        ADD COLUMN seasonal BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_catalog_items_deprecated 
    ON inventory.catalog_items(tenant_id, deprecated) 
    WHERE deprecated = TRUE;

CREATE INDEX IF NOT EXISTS idx_catalog_items_seasonal 
    ON inventory.catalog_items(tenant_id, seasonal) 
    WHERE seasonal = TRUE;

COMMENT ON COLUMN inventory.catalog_items.active IS 'Item is usable (not hidden)';
COMMENT ON COLUMN inventory.catalog_items.deprecated IS 'Do not reorder - phase out';
COMMENT ON COLUMN inventory.catalog_items.seasonal IS 'Seasonal item - reorder logic may be gated';

-- =====================================================
-- 2. UPDATE STOCK MOVEMENTS - VERIFY MOVEMENT TYPES
-- =====================================================
-- Ensure movement_type constraint matches spec exactly

ALTER TABLE inventory.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check;

ALTER TABLE inventory.stock_movements
ADD CONSTRAINT stock_movements_movement_type_check CHECK (movement_type IN (
    'received',        -- PO receipt → +
    'issued',          -- Issue to job/crew → −
    'adjusted',        -- Manual adjustment → ±
    'transferred_in',  -- Transfer from another location → +
    'transferred_out', -- Transfer to another location → −
    'damaged',         -- Damaged/scrapped → −
    'returned',        -- Return to stock → +
    'counted',         -- Cycle count adjustment → ±
    'reserved',        -- Reserved for job (may not use) → neutral to on_hand
    'unreserved',      -- Released reservation → neutral to on_hand
    'consumed'         -- Direct consumption → −
));

COMMENT ON COLUMN inventory.stock_movements.movement_type IS 'Type of stock change: received/issued/adjusted/transferred_in/transferred_out/damaged/returned/counted/reserved/unreserved/consumed';

-- =====================================================
-- 3. UPDATE RESERVATIONS - VERIFY STATUSES
-- =====================================================
-- Reservation statuses: active, fulfilled, released, expired

ALTER TABLE inventory.reservations DROP CONSTRAINT IF EXISTS reservations_status_check;

ALTER TABLE inventory.reservations
ADD CONSTRAINT reservations_status_check CHECK (status IN (
    'active',      -- Reserved, not yet fulfilled
    'fulfilled',   -- Converted to issue
    'released',    -- Manually freed/cancelled
    'expired'      -- Auto-released past needed_by date
));

COMMENT ON COLUMN inventory.reservations.status IS 'Reservation state: active/fulfilled/released/expired';

-- Add index for expired reservations
CREATE INDEX IF NOT EXISTS idx_reservations_expired 
    ON inventory.reservations(tenant_id, needed_by) 
    WHERE status = 'active' AND needed_by IS NOT NULL;

-- =====================================================
-- 4. UPDATE PURCHASE ORDERS - ALIGN STATUSES
-- =====================================================
-- PO statuses per spec

ALTER TABLE inventory.purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check;

ALTER TABLE inventory.purchase_orders
ADD CONSTRAINT purchase_orders_status_check CHECK (status IN (
    'draft',               -- System-generated, not submitted
    'awaiting_approval',   -- Submitted, needs approval
    'approved',            -- Approved, ready to send
    'placed',              -- Sent to vendor
    'acknowledged',        -- Vendor confirmed
    'partially_received',  -- Some items received
    'fully_received',      -- All items received
    'cancelled',           -- Voided
    'closed'               -- Financially closed
));

COMMENT ON COLUMN inventory.purchase_orders.status IS 'PO lifecycle: draft/awaiting_approval/approved/placed/acknowledged/partially_received/fully_received/cancelled/closed';

-- =====================================================
-- 5. UPDATE PURCHASE ORDER LINES - ALIGN STATUSES
-- =====================================================
-- PO Line statuses per spec (simpler than PO)

ALTER TABLE inventory.purchase_order_lines DROP CONSTRAINT IF EXISTS purchase_order_lines_status_check;

ALTER TABLE inventory.purchase_order_lines
ADD CONSTRAINT purchase_order_lines_status_check CHECK (status IN (
    'open',                -- Ordered, not received
    'partially_received',  -- Some qty received
    'fully_received',      -- Complete (renamed from 'received')
    'cancelled'            -- Line voided
));

COMMENT ON COLUMN inventory.purchase_order_lines.status IS 'Line status: open/partially_received/fully_received/cancelled';

-- Update existing 'pending' status to 'open' if any exist
UPDATE inventory.purchase_order_lines 
SET status = 'open' 
WHERE status = 'pending';

-- Update existing 'received' status to 'fully_received' if any exist
UPDATE inventory.purchase_order_lines 
SET status = 'fully_received' 
WHERE status = 'received';

-- =====================================================
-- 6. ADD STOCK MOVEMENT STATUS (OPTIONAL)
-- =====================================================
-- Stock movements can have posting status for more advanced scenarios

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'inventory' 
        AND table_name = 'stock_movements' 
        AND column_name = 'posting_status'
    ) THEN
        ALTER TABLE inventory.stock_movements
        ADD COLUMN posting_status TEXT DEFAULT 'posted' CHECK (posting_status IN ('posted', 'reversed', 'pending'));
        
        COMMENT ON COLUMN inventory.stock_movements.posting_status IS 'Ledger entry status: posted/reversed/pending';
        
        CREATE INDEX idx_stock_movements_posting_status 
            ON inventory.stock_movements(tenant_id, posting_status) 
            WHERE posting_status != 'posted';
    END IF;
END $$;

-- =====================================================
-- 7. CREATE COMPREHENSIVE QUANTITY VIEW
-- =====================================================
-- Single view that shows all four core quantities per item/location

CREATE OR REPLACE VIEW inventory.v_core_quantities AS
SELECT
    COALESCE(pos.tenant_id, oh.tenant_id, res.tenant_id, oo.tenant_id) AS tenant_id,
    COALESCE(pos.catalog_item_id, oh.catalog_item_id, res.catalog_item_id, oo.catalog_item_id) AS catalog_item_id,
    i.sku,
    i.name AS item_name,
    COALESCE(pos.location_id, oh.location_id, res.location_id, oo.location_id) AS location_id,
    l.name AS location_name,
    
    -- 1️⃣ ON-HAND (from ledger - physical reality)
    COALESCE(oh.qty_on_hand, 0) AS qty_on_hand,
    
    -- 2️⃣ RESERVED (committed but not gone)
    COALESCE(res.qty_reserved, 0) AS qty_reserved,
    
    -- 3️⃣ AVAILABLE (what you can still use - DERIVED)
    COALESCE(oh.qty_on_hand, 0) - COALESCE(res.qty_reserved, 0) AS qty_available,
    
    -- 4️⃣ ON-ORDER (coming soon - from POs)
    COALESCE(oo.qty_on_order, 0) AS qty_on_order,
    
    -- 🎯 INVENTORY POSITION (key metric for auto-ordering)
    COALESCE(oh.qty_on_hand, 0) - COALESCE(res.qty_reserved, 0) + COALESCE(oo.qty_on_order, 0) AS inventory_position,
    
    -- Metadata
    oh.last_movement_at,
    oo.earliest_expected_date,
    res.reservation_count,
    oo.po_count
FROM (
    -- Base: all combinations that exist
    SELECT DISTINCT
        tenant_id,
        catalog_item_id,
        location_id
    FROM (
        SELECT tenant_id, catalog_item_id, location_id FROM inventory.v_on_hand_by_item_location
        UNION
        SELECT tenant_id, catalog_item_id, location_id FROM inventory.v_reserved_by_item_location
        UNION
        SELECT tenant_id, catalog_item_id, location_id FROM inventory.v_on_order_by_item_location
    ) base
) pos
LEFT JOIN inventory.v_on_hand_by_item_location oh
    ON pos.tenant_id = oh.tenant_id
    AND pos.catalog_item_id = oh.catalog_item_id
    AND pos.location_id = oh.location_id
LEFT JOIN inventory.v_reserved_by_item_location res
    ON pos.tenant_id = res.tenant_id
    AND pos.catalog_item_id = res.catalog_item_id
    AND pos.location_id = res.location_id
LEFT JOIN inventory.v_on_order_by_item_location oo
    ON pos.tenant_id = oo.tenant_id
    AND pos.catalog_item_id = oo.catalog_item_id
    AND pos.location_id = oo.location_id
LEFT JOIN inventory.catalog_items i
    ON pos.catalog_item_id = i.id
LEFT JOIN inventory.locations l
    ON pos.location_id = l.id;

COMMENT ON VIEW inventory.v_core_quantities IS 'Complete view of all 4 core quantities: on_hand, reserved, available, on_order + inventory position';

-- =====================================================
-- 8. CREATE STATUS SUMMARY VIEWS
-- =====================================================

-- View: Item Status Summary
CREATE OR REPLACE VIEW inventory.v_item_status_summary AS
SELECT
    tenant_id,
    COUNT(*) AS total_items,
    COUNT(*) FILTER (WHERE active = TRUE AND deprecated = FALSE) AS active_items,
    COUNT(*) FILTER (WHERE active = FALSE) AS inactive_items,
    COUNT(*) FILTER (WHERE deprecated = TRUE) AS deprecated_items,
    COUNT(*) FILTER (WHERE seasonal = TRUE) AS seasonal_items,
    COUNT(*) FILTER (WHERE reorder_point IS NOT NULL) AS items_with_reorder_point
FROM inventory.catalog_items
GROUP BY tenant_id;

COMMENT ON VIEW inventory.v_item_status_summary IS 'Summary of catalog item statuses by tenant';

-- View: Reservation Status Summary
CREATE OR REPLACE VIEW inventory.v_reservation_status_summary AS
SELECT
    tenant_id,
    status,
    COUNT(*) AS reservation_count,
    SUM(qty) AS total_qty_reserved,
    COUNT(*) FILTER (WHERE needed_by < CURRENT_DATE) AS overdue_count
FROM inventory.reservations
GROUP BY tenant_id, status;

COMMENT ON VIEW inventory.v_reservation_status_summary IS 'Summary of reservations by status';

-- View: PO Status Summary
CREATE OR REPLACE VIEW inventory.v_po_status_summary AS
SELECT
    po.tenant_id,
    po.status,
    COUNT(DISTINCT po.id) AS po_count,
    COUNT(pol.id) AS total_lines,
    SUM(pol.qty_ordered) AS total_qty_ordered,
    SUM(pol.qty_received) AS total_qty_received,
    SUM(pol.qty_ordered - pol.qty_received) AS total_qty_outstanding
FROM inventory.purchase_orders po
LEFT JOIN inventory.purchase_order_lines pol ON po.id = pol.po_id
GROUP BY po.tenant_id, po.status;

COMMENT ON VIEW inventory.v_po_status_summary IS 'Summary of purchase orders by status';

-- =====================================================
-- 9. VERIFICATION QUERY FUNCTION
-- =====================================================

-- Function to verify no anti-patterns exist
CREATE OR REPLACE FUNCTION inventory.verify_quantity_integrity(
    p_tenant_id UUID
) RETURNS TABLE(
    check_name TEXT,
    status TEXT,
    details TEXT
) AS $$
BEGIN
    -- Check 1: No negative on-hand (after accounting for all movements)
    RETURN QUERY
    SELECT
        'No Negative On-Hand'::TEXT,
        CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END::TEXT,
        CASE WHEN COUNT(*) = 0 
            THEN 'All locations have non-negative on-hand quantities'
            ELSE COUNT(*)::TEXT || ' locations have negative on-hand'
        END::TEXT
    FROM inventory.v_on_hand_by_item_location
    WHERE tenant_id = p_tenant_id
      AND qty_on_hand < 0;
    
    -- Check 2: Reserved doesn't exceed on-hand
    RETURN QUERY
    SELECT
        'Reserved <= On-Hand'::TEXT,
        CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'WARNING' END::TEXT,
        CASE WHEN COUNT(*) = 0 
            THEN 'All reservations are backed by on-hand stock'
            ELSE COUNT(*)::TEXT || ' locations have over-reserved stock'
        END::TEXT
    FROM inventory.v_core_quantities
    WHERE tenant_id = p_tenant_id
      AND qty_reserved > qty_on_hand;
    
    -- Check 3: All stock movements have last_event_id
    RETURN QUERY
    SELECT
        'Stock Movements Idempotency'::TEXT,
        CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END::TEXT,
        CASE WHEN COUNT(*) = 0 
            THEN 'All stock movements have last_event_id'
            ELSE COUNT(*)::TEXT || ' movements missing last_event_id'
        END::TEXT
    FROM inventory.stock_movements
    WHERE tenant_id = p_tenant_id
      AND last_event_id IS NULL;
    
    -- Check 4: No direct quantity columns on catalog_items
    RETURN QUERY
    SELECT
        'No Quantity on Master Data'::TEXT,
        'PASS'::TEXT,
        'Catalog items correctly have no qty_on_hand column'::TEXT
    WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'inventory'
          AND table_name = 'catalog_items'
          AND column_name IN ('qty_on_hand', 'quantity', 'stock_level')
    );
    
    -- Check 5: All active reservations have future or null needed_by
    RETURN QUERY
    SELECT
        'Reservation Expiry'::TEXT,
        CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'WARNING' END::TEXT,
        CASE WHEN COUNT(*) = 0 
            THEN 'No overdue active reservations'
            ELSE COUNT(*)::TEXT || ' active reservations past needed_by date'
        END::TEXT
    FROM inventory.reservations
    WHERE tenant_id = p_tenant_id
      AND status = 'active'
      AND needed_by < CURRENT_DATE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION inventory.verify_quantity_integrity IS 'Run integrity checks on inventory quantities and statuses';

-- =====================================================
-- 10. EXAMPLE USAGE QUERIES
-- =====================================================

/*
-- Get all four core quantities for a tenant:
SELECT * FROM inventory.v_core_quantities
WHERE tenant_id = 'YOUR_TENANT_ID'
ORDER BY inventory_position ASC;

-- Items below reorder point (uses inventory position):
SELECT * FROM inventory.v_reorder_suggestions
WHERE tenant_id = 'YOUR_TENANT_ID'
ORDER BY inventory_position ASC;

-- Run integrity checks:
SELECT * FROM inventory.verify_quantity_integrity('YOUR_TENANT_ID');

-- Get status summaries:
SELECT * FROM inventory.v_item_status_summary WHERE tenant_id = 'YOUR_TENANT_ID';
SELECT * FROM inventory.v_reservation_status_summary WHERE tenant_id = 'YOUR_TENANT_ID';
SELECT * FROM inventory.v_po_status_summary WHERE tenant_id = 'YOUR_TENANT_ID';
*/

-- =====================================================
-- END OF VERIFICATION MIGRATION
-- =====================================================
