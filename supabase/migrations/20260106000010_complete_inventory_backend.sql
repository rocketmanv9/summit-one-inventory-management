-- =====================================================
-- COMPLETE INVENTORY BACKEND WITH QUANTITIES & AUTO-ORDERING
-- =====================================================
-- This migration adds:
-- 1. Stock movement ledger (authoritative source)
-- 2. Vendors and vendor catalog mapping
-- 3. Reorder settings on items
-- 4. Derived views for quantities (on_hand, reserved, available, on_order, position)
-- 5. Auto-ordering support structures
-- 6. Enhanced RLS policies
-- 7. Idempotency patterns throughout

-- =====================================================
-- 1. ADD REORDER SETTINGS TO CATALOG_ITEMS
-- =====================================================
ALTER TABLE inventory.catalog_items 
ADD COLUMN IF NOT EXISTS min_stock_level NUMERIC(18, 4) NULL,
ADD COLUMN IF NOT EXISTS reorder_point NUMERIC(18, 4) NULL,
ADD COLUMN IF NOT EXISTS reorder_qty NUMERIC(18, 4) NULL,
ADD COLUMN IF NOT EXISTS target_level NUMERIC(18, 4) NULL,
ADD COLUMN IF NOT EXISTS preferred_vendor_id UUID NULL,
ADD COLUMN IF NOT EXISTS lead_time_days INTEGER NULL DEFAULT 7,
ADD COLUMN IF NOT EXISTS pack_size NUMERIC(18, 4) NULL DEFAULT 1;

COMMENT ON COLUMN inventory.catalog_items.min_stock_level IS 'Minimum stock level before alert';
COMMENT ON COLUMN inventory.catalog_items.reorder_point IS 'Inventory position threshold to trigger reorder';
COMMENT ON COLUMN inventory.catalog_items.reorder_qty IS 'Fixed quantity to order when reordering';
COMMENT ON COLUMN inventory.catalog_items.target_level IS 'Alternative: order up to this level';
COMMENT ON COLUMN inventory.catalog_items.preferred_vendor_id IS 'FK to vendors table (added below)';
COMMENT ON COLUMN inventory.catalog_items.lead_time_days IS 'Expected days from order to receipt';
COMMENT ON COLUMN inventory.catalog_items.pack_size IS 'Vendor pack size for rounding orders';

-- =====================================================
-- 2. CREATE VENDORS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS inventory.vendors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL,
    code TEXT NULL,
    contact_name TEXT NULL,
    contact_email TEXT NULL,
    contact_phone TEXT NULL,
    payment_terms TEXT NULL,
    notes TEXT NULL,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Unique constraints
    CONSTRAINT vendors_tenant_name_unique UNIQUE (tenant_id, name),
    CONSTRAINT vendors_tenant_code_unique UNIQUE (tenant_id, code)
);

CREATE INDEX idx_vendors_tenant_id ON inventory.vendors(tenant_id);
CREATE INDEX idx_vendors_active ON inventory.vendors(tenant_id, active);

COMMENT ON TABLE inventory.vendors IS 'Vendor/supplier master data';

-- Enable RLS
ALTER TABLE inventory.vendors ENABLE ROW LEVEL SECURITY;

CREATE POLICY vendors_tenant_isolation ON inventory.vendors
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

-- Trigger for updated_at
CREATE TRIGGER update_vendors_updated_at
    BEFORE UPDATE ON inventory.vendors
    FOR EACH ROW
    EXECUTE FUNCTION inventory.update_updated_at_column();

-- =====================================================
-- 3. CREATE VENDOR CATALOG MAPPING TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS inventory.vendor_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    vendor_id UUID NOT NULL REFERENCES inventory.vendors(id) ON DELETE CASCADE,
    catalog_item_id UUID NOT NULL REFERENCES inventory.catalog_items(id) ON DELETE CASCADE,
    vendor_sku TEXT NOT NULL,
    vendor_uom TEXT NULL,
    pack_size NUMERIC(18, 4) NULL DEFAULT 1,
    is_preferred BOOLEAN DEFAULT FALSE,
    unit_cost NUMERIC(18, 4) NULL,
    currency TEXT DEFAULT 'USD',
    lead_time_days INTEGER NULL,
    min_order_qty NUMERIC(18, 4) NULL,
    notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Unique constraint: one mapping per vendor + item
    CONSTRAINT vendor_items_tenant_vendor_item_unique UNIQUE (tenant_id, vendor_id, catalog_item_id)
);

CREATE INDEX idx_vendor_items_tenant_id ON inventory.vendor_items(tenant_id);
CREATE INDEX idx_vendor_items_vendor_id ON inventory.vendor_items(vendor_id);
CREATE INDEX idx_vendor_items_catalog_item_id ON inventory.vendor_items(catalog_item_id);
CREATE INDEX idx_vendor_items_preferred ON inventory.vendor_items(tenant_id, catalog_item_id, is_preferred) WHERE is_preferred = TRUE;

COMMENT ON TABLE inventory.vendor_items IS 'Maps catalog items to vendor SKUs for auto-ordering';

-- Enable RLS
ALTER TABLE inventory.vendor_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY vendor_items_tenant_isolation ON inventory.vendor_items
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

-- Trigger for updated_at
CREATE TRIGGER update_vendor_items_updated_at
    BEFORE UPDATE ON inventory.vendor_items
    FOR EACH ROW
    EXECUTE FUNCTION inventory.update_updated_at_column();

-- Now we can add the FK constraint for preferred_vendor_id
ALTER TABLE inventory.catalog_items
DROP CONSTRAINT IF EXISTS catalog_items_preferred_vendor_fk,
ADD CONSTRAINT catalog_items_preferred_vendor_fk 
    FOREIGN KEY (preferred_vendor_id) REFERENCES inventory.vendors(id) ON DELETE SET NULL;

-- =====================================================
-- 4. CREATE STOCK MOVEMENTS LEDGER (AUTHORITATIVE)
-- =====================================================
-- This is the single source of truth for all stock changes
CREATE TABLE IF NOT EXISTS inventory.stock_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    catalog_item_id UUID NOT NULL REFERENCES inventory.catalog_items(id) ON DELETE RESTRICT,
    location_id UUID NOT NULL REFERENCES inventory.locations(id) ON DELETE RESTRICT,
    quantity_delta NUMERIC(18, 4) NOT NULL, -- Positive = increase, Negative = decrease
    movement_type TEXT NOT NULL CHECK (movement_type IN (
        'received', 'issued', 'adjusted', 'transferred_in', 'transferred_out',
        'damaged', 'returned', 'counted', 'reserved', 'unreserved', 'consumed'
    )),
    source_ref_type TEXT NULL, -- 'po', 'receipt', 'reservation', 'transfer', 'cycle_count', 'manual'
    source_ref_id UUID NULL,
    unit_cost NUMERIC(18, 4) NULL,
    currency TEXT DEFAULT 'USD',
    reason TEXT NULL,
    notes TEXT NULL,
    correlation_id UUID NULL, -- For linking transfers (debit + credit)
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by_user_id UUID NULL,
    last_event_id TEXT NOT NULL, -- ✅ IDEMPOTENCY KEY
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Unique constraint for idempotency
    CONSTRAINT stock_movements_tenant_last_event_id_unique UNIQUE (tenant_id, last_event_id)
);

CREATE INDEX idx_stock_movements_tenant_id ON inventory.stock_movements(tenant_id);
CREATE INDEX idx_stock_movements_item_location ON inventory.stock_movements(tenant_id, catalog_item_id, location_id);
CREATE INDEX idx_stock_movements_occurred_at ON inventory.stock_movements(tenant_id, occurred_at DESC);
CREATE INDEX idx_stock_movements_movement_type ON inventory.stock_movements(tenant_id, movement_type);
CREATE INDEX idx_stock_movements_source_ref ON inventory.stock_movements(tenant_id, source_ref_type, source_ref_id) 
    WHERE source_ref_type IS NOT NULL;
CREATE INDEX idx_stock_movements_correlation_id ON inventory.stock_movements(correlation_id) 
    WHERE correlation_id IS NOT NULL;
CREATE INDEX idx_stock_movements_created_at ON inventory.stock_movements(created_at DESC);

COMMENT ON TABLE inventory.stock_movements IS 'Immutable ledger of all stock changes - source of truth';
COMMENT ON COLUMN inventory.stock_movements.quantity_delta IS 'Change in quantity (+ or -)';
COMMENT ON COLUMN inventory.stock_movements.last_event_id IS 'Idempotency key for event processing';
COMMENT ON COLUMN inventory.stock_movements.correlation_id IS 'Links transfer pairs (from/to)';

-- Enable RLS
ALTER TABLE inventory.stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY stock_movements_tenant_isolation ON inventory.stock_movements
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

-- =====================================================
-- 5. ADD last_event_id TO EXISTING TABLES
-- =====================================================

-- Add to purchase_orders if not exists
ALTER TABLE inventory.purchase_orders
ADD COLUMN IF NOT EXISTS last_event_id TEXT NULL;

-- Create unique constraint after column exists
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'purchase_orders_tenant_last_event_id_unique'
    ) THEN
        -- First set a value for any existing rows
        UPDATE inventory.purchase_orders 
        SET last_event_id = 'legacy_' || id::TEXT 
        WHERE last_event_id IS NULL;
        
        -- Make column NOT NULL
        ALTER TABLE inventory.purchase_orders 
        ALTER COLUMN last_event_id SET NOT NULL;
        
        -- Add unique constraint
        ALTER TABLE inventory.purchase_orders
        ADD CONSTRAINT purchase_orders_tenant_last_event_id_unique 
        UNIQUE (tenant_id, last_event_id);
    END IF;
END $$;

-- Add to purchase_order_lines if not exists
ALTER TABLE inventory.purchase_order_lines
ADD COLUMN IF NOT EXISTS last_event_id TEXT NULL;

DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'purchase_order_lines_tenant_last_event_id_unique'
    ) THEN
        UPDATE inventory.purchase_order_lines 
        SET last_event_id = 'legacy_' || id::TEXT 
        WHERE last_event_id IS NULL;
        
        ALTER TABLE inventory.purchase_order_lines 
        ALTER COLUMN last_event_id SET NOT NULL;
        
        ALTER TABLE inventory.purchase_order_lines
        ADD CONSTRAINT purchase_order_lines_tenant_last_event_id_unique 
        UNIQUE (tenant_id, last_event_id);
    END IF;
END $$;

-- =====================================================
-- 6. CREATE DERIVED VIEWS FOR QUANTITIES
-- =====================================================

-- View: ON-HAND by item/location (from stock_movements ledger)
CREATE OR REPLACE VIEW inventory.v_on_hand_by_item_location AS
SELECT
    tenant_id,
    catalog_item_id,
    location_id,
    SUM(quantity_delta) AS qty_on_hand,
    MAX(occurred_at) AS last_movement_at
FROM inventory.stock_movements
GROUP BY tenant_id, catalog_item_id, location_id
HAVING SUM(quantity_delta) != 0; -- Exclude zero balances

COMMENT ON VIEW inventory.v_on_hand_by_item_location IS 'Current on-hand quantity derived from stock_movements ledger';

-- View: RESERVED by item/location (from active reservations)
CREATE OR REPLACE VIEW inventory.v_reserved_by_item_location AS
SELECT
    tenant_id,
    catalog_item_id,
    location_id,
    SUM(qty) AS qty_reserved,
    COUNT(*) AS reservation_count
FROM inventory.reservations
WHERE status = 'active'
GROUP BY tenant_id, catalog_item_id, location_id;

COMMENT ON VIEW inventory.v_reserved_by_item_location IS 'Total reserved quantity from active reservations';

-- View: AVAILABLE by item/location (on_hand - reserved)
CREATE OR REPLACE VIEW inventory.v_available_by_item_location AS
SELECT
    COALESCE(oh.tenant_id, res.tenant_id) AS tenant_id,
    COALESCE(oh.catalog_item_id, res.catalog_item_id) AS catalog_item_id,
    COALESCE(oh.location_id, res.location_id) AS location_id,
    COALESCE(oh.qty_on_hand, 0) AS qty_on_hand,
    COALESCE(res.qty_reserved, 0) AS qty_reserved,
    COALESCE(oh.qty_on_hand, 0) - COALESCE(res.qty_reserved, 0) AS qty_available,
    oh.last_movement_at
FROM inventory.v_on_hand_by_item_location oh
FULL OUTER JOIN inventory.v_reserved_by_item_location res
    ON oh.tenant_id = res.tenant_id
    AND oh.catalog_item_id = res.catalog_item_id
    AND oh.location_id = res.location_id;

COMMENT ON VIEW inventory.v_available_by_item_location IS 'Available quantity = on_hand - reserved';

-- View: ON-ORDER by item/ship_to_location (from PO lines)
CREATE OR REPLACE VIEW inventory.v_on_order_by_item_location AS
SELECT
    pol.tenant_id,
    pol.catalog_item_id,
    po.delivery_location_id AS location_id,
    SUM(pol.qty_ordered - pol.qty_received) AS qty_on_order,
    COUNT(DISTINCT po.id) AS po_count,
    MIN(po.expected_delivery_date) AS earliest_expected_date
FROM inventory.purchase_order_lines pol
JOIN inventory.purchase_orders po ON pol.po_id = po.id
WHERE po.status NOT IN ('cancelled', 'closed')
  AND pol.status NOT IN ('cancelled', 'received')
  AND (pol.qty_ordered - pol.qty_received) > 0
GROUP BY pol.tenant_id, pol.catalog_item_id, po.delivery_location_id;

COMMENT ON VIEW inventory.v_on_order_by_item_location IS 'Quantity on open POs not yet received';

-- View: INVENTORY POSITION (on_hand - reserved + on_order)
CREATE OR REPLACE VIEW inventory.v_inventory_position AS
SELECT
    COALESCE(avail.tenant_id, oo.tenant_id) AS tenant_id,
    COALESCE(avail.catalog_item_id, oo.catalog_item_id) AS catalog_item_id,
    COALESCE(avail.location_id, oo.location_id) AS location_id,
    COALESCE(avail.qty_on_hand, 0) AS qty_on_hand,
    COALESCE(avail.qty_reserved, 0) AS qty_reserved,
    COALESCE(avail.qty_available, 0) AS qty_available,
    COALESCE(oo.qty_on_order, 0) AS qty_on_order,
    COALESCE(avail.qty_on_hand, 0) - COALESCE(avail.qty_reserved, 0) + COALESCE(oo.qty_on_order, 0) AS inventory_position,
    avail.last_movement_at,
    oo.earliest_expected_date
FROM inventory.v_available_by_item_location avail
FULL OUTER JOIN inventory.v_on_order_by_item_location oo
    ON avail.tenant_id = oo.tenant_id
    AND avail.catalog_item_id = oo.catalog_item_id
    AND avail.location_id = oo.location_id;

COMMENT ON VIEW inventory.v_inventory_position IS 'Comprehensive inventory position: on_hand - reserved + on_order';

-- =====================================================
-- 7. CREATE REORDER SUGGESTION VIEW
-- =====================================================
CREATE OR REPLACE VIEW inventory.v_reorder_suggestions AS
SELECT
    i.tenant_id,
    i.id AS catalog_item_id,
    i.sku,
    i.name,
    i.reorder_point,
    i.reorder_qty,
    i.target_level,
    i.pack_size,
    i.preferred_vendor_id,
    i.lead_time_days,
    pos.location_id,
    pos.inventory_position,
    pos.qty_on_hand,
    pos.qty_reserved,
    pos.qty_on_order,
    -- Calculate suggested order quantity
    CASE
        WHEN i.target_level IS NOT NULL THEN
            -- Order up to target level
            GREATEST(0, CEIL((i.target_level - pos.inventory_position) / i.pack_size) * i.pack_size)
        WHEN i.reorder_qty IS NOT NULL THEN
            -- Fixed reorder quantity rounded to pack size
            CEIL(i.reorder_qty / i.pack_size) * i.pack_size
        ELSE
            -- Default: order to bring position up to reorder_point * 2
            CEIL((i.reorder_point * 2 - pos.inventory_position) / i.pack_size) * i.pack_size
    END AS suggested_order_qty,
    v.name AS preferred_vendor_name,
    vi.vendor_sku,
    vi.unit_cost AS estimated_unit_cost,
    pos.earliest_expected_date AS next_expected_receipt
FROM inventory.catalog_items i
LEFT JOIN inventory.v_inventory_position pos 
    ON i.tenant_id = pos.tenant_id 
    AND i.id = pos.catalog_item_id
LEFT JOIN inventory.vendors v 
    ON i.preferred_vendor_id = v.id
LEFT JOIN inventory.vendor_items vi 
    ON i.id = vi.catalog_item_id 
    AND i.preferred_vendor_id = vi.vendor_id
WHERE i.active = TRUE
  AND i.reorder_point IS NOT NULL
  AND COALESCE(pos.inventory_position, 0) <= i.reorder_point;

COMMENT ON VIEW inventory.v_reorder_suggestions IS 'Items below reorder point with suggested order quantities';

-- =====================================================
-- 8. CREATE ACCOUNTING EXPENSES TABLE (OPTIONAL)
-- =====================================================
CREATE TABLE IF NOT EXISTS inventory.accounting_expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    vendor_id UUID NULL REFERENCES inventory.vendors(id) ON DELETE SET NULL,
    po_id UUID NULL REFERENCES inventory.purchase_orders(id) ON DELETE SET NULL,
    expense_date DATE NOT NULL,
    amount NUMERIC(18, 4) NOT NULL,
    currency TEXT DEFAULT 'USD',
    status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'matched', 'disputed', 'ignored')),
    receipt_url TEXT NULL,
    invoice_number TEXT NULL,
    description TEXT NULL,
    matched_at TIMESTAMPTZ NULL,
    last_event_id TEXT NOT NULL, -- ✅ Idempotency
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Unique constraint for idempotency
    CONSTRAINT accounting_expenses_tenant_last_event_id_unique UNIQUE (tenant_id, last_event_id)
);

CREATE INDEX idx_accounting_expenses_tenant_id ON inventory.accounting_expenses(tenant_id);
CREATE INDEX idx_accounting_expenses_vendor_id ON inventory.accounting_expenses(vendor_id) WHERE vendor_id IS NOT NULL;
CREATE INDEX idx_accounting_expenses_po_id ON inventory.accounting_expenses(po_id) WHERE po_id IS NOT NULL;
CREATE INDEX idx_accounting_expenses_expense_date ON inventory.accounting_expenses(tenant_id, expense_date DESC);
CREATE INDEX idx_accounting_expenses_status ON inventory.accounting_expenses(tenant_id, status);

COMMENT ON TABLE inventory.accounting_expenses IS 'Non-authoritative expense tracking for matching to POs';

-- Enable RLS
ALTER TABLE inventory.accounting_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY accounting_expenses_tenant_isolation ON inventory.accounting_expenses
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

-- Trigger for updated_at
CREATE TRIGGER update_accounting_expenses_updated_at
    BEFORE UPDATE ON inventory.accounting_expenses
    FOR EACH ROW
    EXECUTE FUNCTION inventory.update_updated_at_column();

-- =====================================================
-- 9. IDEMPOTENT EVENT PROCESSING FUNCTIONS
-- =====================================================

-- Function: Idempotently insert stock movement
CREATE OR REPLACE FUNCTION inventory.insert_stock_movement(
    p_tenant_id UUID,
    p_catalog_item_id UUID,
    p_location_id UUID,
    p_quantity_delta NUMERIC,
    p_movement_type TEXT,
    p_source_ref_type TEXT,
    p_source_ref_id UUID,
    p_unit_cost NUMERIC,
    p_reason TEXT,
    p_notes TEXT,
    p_correlation_id UUID,
    p_occurred_at TIMESTAMPTZ,
    p_created_by_user_id UUID,
    p_last_event_id TEXT
) RETURNS UUID AS $$
DECLARE
    v_movement_id UUID;
BEGIN
    INSERT INTO inventory.stock_movements (
        tenant_id,
        catalog_item_id,
        location_id,
        quantity_delta,
        movement_type,
        source_ref_type,
        source_ref_id,
        unit_cost,
        reason,
        notes,
        correlation_id,
        occurred_at,
        created_by_user_id,
        last_event_id
    ) VALUES (
        p_tenant_id,
        p_catalog_item_id,
        p_location_id,
        p_quantity_delta,
        p_movement_type,
        p_source_ref_type,
        p_source_ref_id,
        p_unit_cost,
        p_reason,
        p_notes,
        p_correlation_id,
        p_occurred_at,
        p_created_by_user_id,
        p_last_event_id
    )
    ON CONFLICT (tenant_id, last_event_id) DO NOTHING
    RETURNING id INTO v_movement_id;
    
    -- If conflict occurred, get existing movement id
    IF v_movement_id IS NULL THEN
        SELECT id INTO v_movement_id
        FROM inventory.stock_movements
        WHERE tenant_id = p_tenant_id AND last_event_id = p_last_event_id;
    END IF;
    
    RETURN v_movement_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION inventory.insert_stock_movement IS 'Idempotently insert a stock movement with event deduplication';

-- Function: Process stock receipt from PO
CREATE OR REPLACE FUNCTION inventory.process_stock_receipt(
    p_tenant_id UUID,
    p_po_id UUID,
    p_location_id UUID,
    p_received_items JSONB, -- [{po_line_id, qty_received, unit_cost}]
    p_received_by_user_id UUID,
    p_last_event_id TEXT
) RETURNS UUID AS $$
DECLARE
    v_receipt_id UUID;
    v_item JSONB;
    v_po_line RECORD;
    v_movement_id UUID;
BEGIN
    -- Create receipt record
    INSERT INTO inventory.receipts (
        tenant_id,
        po_id,
        receipt_number,
        received_at,
        received_by_user_id,
        location_id,
        last_event_id
    ) VALUES (
        p_tenant_id,
        p_po_id,
        'RCV-' || EXTRACT(EPOCH FROM NOW())::BIGINT::TEXT,
        NOW(),
        p_received_by_user_id,
        p_location_id,
        p_last_event_id
    )
    ON CONFLICT (tenant_id, last_event_id) DO NOTHING
    RETURNING id INTO v_receipt_id;
    
    -- If already processed, return existing receipt
    IF v_receipt_id IS NULL THEN
        SELECT id INTO v_receipt_id
        FROM inventory.receipts
        WHERE tenant_id = p_tenant_id AND last_event_id = p_last_event_id;
        RETURN v_receipt_id;
    END IF;
    
    -- Process each received item
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_received_items)
    LOOP
        -- Get PO line details
        SELECT * INTO v_po_line
        FROM inventory.purchase_order_lines
        WHERE id = (v_item->>'po_line_id')::UUID
          AND tenant_id = p_tenant_id;
        
        IF v_po_line.id IS NULL THEN
            RAISE EXCEPTION 'PO line not found: %', v_item->>'po_line_id';
        END IF;
        
        -- Create receipt line
        INSERT INTO inventory.receipt_lines (
            tenant_id,
            receipt_id,
            po_line_id,
            line_number,
            catalog_item_id,
            qty_received
        ) VALUES (
            p_tenant_id,
            v_receipt_id,
            v_po_line.id,
            (v_item->>'line_number')::INTEGER,
            v_po_line.catalog_item_id,
            (v_item->>'qty_received')::NUMERIC
        );
        
        -- Create stock movement
        v_movement_id := inventory.insert_stock_movement(
            p_tenant_id,
            v_po_line.catalog_item_id,
            p_location_id,
            (v_item->>'qty_received')::NUMERIC,
            'received',
            'receipt',
            v_receipt_id,
            (v_item->>'unit_cost')::NUMERIC,
            'Received from PO ' || v_po_line.po_id::TEXT,
            NULL,
            NULL,
            NOW(),
            p_received_by_user_id,
            p_last_event_id || '_line_' || v_po_line.id::TEXT
        );
        
        -- Update PO line received quantity
        UPDATE inventory.purchase_order_lines
        SET qty_received = qty_received + (v_item->>'qty_received')::NUMERIC,
            status = CASE
                WHEN qty_received + (v_item->>'qty_received')::NUMERIC >= qty_ordered THEN 'received'
                ELSE 'partially_received'
            END
        WHERE id = v_po_line.id;
    END LOOP;
    
    -- Update PO status
    UPDATE inventory.purchase_orders
    SET status = CASE
        WHEN EXISTS (
            SELECT 1 FROM inventory.purchase_order_lines
            WHERE po_id = p_po_id AND status != 'received'
        ) THEN 'partially_received'
        ELSE 'received'
    END
    WHERE id = p_po_id;
    
    RETURN v_receipt_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION inventory.process_stock_receipt IS 'Idempotently process a stock receipt from a purchase order';

-- =====================================================
-- 10. AUTO-ORDERING HELPER FUNCTION
-- =====================================================

-- Function: Generate draft POs for items below reorder point
CREATE OR REPLACE FUNCTION inventory.generate_reorder_pos(
    p_tenant_id UUID
) RETURNS TABLE(
    vendor_id UUID,
    location_id UUID,
    items_count INTEGER,
    total_estimated_cost NUMERIC
) AS $$
BEGIN
    -- This function can be called by a cron job
    -- It creates draft POs grouped by vendor and delivery location
    
    RETURN QUERY
    WITH reorders AS (
        SELECT
            rs.preferred_vendor_id,
            rs.location_id,
            rs.catalog_item_id,
            rs.suggested_order_qty,
            rs.estimated_unit_cost,
            ROW_NUMBER() OVER (
                PARTITION BY rs.preferred_vendor_id, rs.location_id
                ORDER BY rs.inventory_position ASC
            ) AS line_number
        FROM inventory.v_reorder_suggestions rs
        WHERE rs.tenant_id = p_tenant_id
          AND rs.preferred_vendor_id IS NOT NULL
          AND rs.suggested_order_qty > 0
    ),
    po_groups AS (
        SELECT
            preferred_vendor_id,
            location_id,
            COUNT(*) AS items_count,
            SUM(suggested_order_qty * COALESCE(estimated_unit_cost, 0)) AS total_cost
        FROM reorders
        GROUP BY preferred_vendor_id, location_id
    )
    SELECT
        pg.preferred_vendor_id AS vendor_id,
        pg.location_id,
        pg.items_count::INTEGER,
        pg.total_cost
    FROM po_groups pg;
    
    -- Note: Actual PO creation would be done by calling application
    -- to avoid side effects in this function
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION inventory.generate_reorder_pos IS 'Analyze reorder suggestions and return draft PO groupings';

-- =====================================================
-- 11. EXAMPLE QUERIES
-- =====================================================

-- These are provided as comments for reference

/*
-- Query: Low stock items (position < reorder point)
SELECT
    i.sku,
    i.name,
    l.name AS location,
    pos.inventory_position,
    i.reorder_point,
    i.reorder_qty,
    v.name AS preferred_vendor
FROM inventory.catalog_items i
JOIN inventory.v_inventory_position pos ON i.id = pos.catalog_item_id
JOIN inventory.locations l ON pos.location_id = l.id
LEFT JOIN inventory.vendors v ON i.preferred_vendor_id = v.id
WHERE i.tenant_id = 'YOUR_TENANT_ID'
  AND i.active = TRUE
  AND i.reorder_point IS NOT NULL
  AND pos.inventory_position < i.reorder_point
ORDER BY pos.inventory_position ASC
LIMIT 100;

-- Query: Reorder suggestions ready to create POs
SELECT * FROM inventory.v_reorder_suggestions
WHERE tenant_id = 'YOUR_TENANT_ID'
  AND preferred_vendor_id IS NOT NULL
ORDER BY inventory_position ASC;

-- Query: Available stock by location
SELECT
    l.name AS location,
    i.sku,
    i.name AS item_name,
    avail.qty_on_hand,
    avail.qty_reserved,
    avail.qty_available
FROM inventory.v_available_by_item_location avail
JOIN inventory.catalog_items i ON avail.catalog_item_id = i.id
JOIN inventory.locations l ON avail.location_id = l.id
WHERE avail.tenant_id = 'YOUR_TENANT_ID'
  AND avail.qty_available > 0
ORDER BY l.name, i.sku;

-- Query: Generate reorder PO groupings
SELECT * FROM inventory.generate_reorder_pos('YOUR_TENANT_ID');

-- Process a stock receipt (idempotent)
SELECT inventory.process_stock_receipt(
    'YOUR_TENANT_ID',
    'PO_UUID',
    'WAREHOUSE_LOCATION_UUID',
    '[
        {"po_line_id": "LINE1_UUID", "qty_received": 100, "unit_cost": 12.50, "line_number": 1},
        {"po_line_id": "LINE2_UUID", "qty_received": 50, "unit_cost": 8.00, "line_number": 2}
    ]'::JSONB,
    'USER_UUID',
    'event_12345_receipt'
);
*/

-- =====================================================
-- 12. NOTES ON EVENT PROCESSING
-- =====================================================

/*
EVENT PROCESSING PATTERN:

All event handlers should follow this pattern:

1. Accept an event with last_event_id
2. Insert into appropriate table with ON CONFLICT DO NOTHING
3. If insert succeeds (not a duplicate), process the event:
   - Create stock movements
   - Update read models
   - Update PO statuses
   - Create reservations
   - etc.
4. Return success

Example webhook handler pseudocode:

async function handleStockReceived(event) {
  const { tenant_id, po_id, location_id, items, last_event_id } = event;
  
  // This function is idempotent - safe to retry
  const receipt_id = await db.select(
    inventory.process_stock_receipt(
      tenant_id,
      po_id,
      location_id,
      items,
      event.user_id,
      last_event_id
    )
  );
  
  return { success: true, receipt_id };
}

KEY TABLES WITH IDEMPOTENCY:
- inventory.inventory_events (last_event_id)
- inventory.asset_events (last_event_id)
- inventory.procurement_events (last_event_id)
- inventory.stock_movements (last_event_id)
- inventory.reservations (last_event_id)
- inventory.receipts (last_event_id)
- inventory.purchase_orders (last_event_id)
- inventory.purchase_order_lines (last_event_id)
- inventory.accounting_expenses (last_event_id)

CRON JOB FOR AUTO-ORDERING:

Run every hour or daily:

1. Call inventory.generate_reorder_pos(tenant_id) for each tenant
2. For each returned grouping:
   - Create draft PO
   - Add lines from v_reorder_suggestions
   - Optionally auto-submit based on rules
3. Emit events for created POs

REBUILDING READ MODELS:

Stock balances can be rebuilt from stock_movements:

INSERT INTO inventory.stock_balances (tenant_id, catalog_item_id, location_id, qty_on_hand)
SELECT
    tenant_id,
    catalog_item_id,
    location_id,
    SUM(quantity_delta) AS qty_on_hand
FROM inventory.stock_movements
WHERE tenant_id = 'YOUR_TENANT_ID'
GROUP BY tenant_id, catalog_item_id, location_id
ON CONFLICT (tenant_id, catalog_item_id, location_id)
DO UPDATE SET
    qty_on_hand = EXCLUDED.qty_on_hand,
    updated_at = NOW();

Reserved quantities are recalculated from active reservations.
*/

-- =====================================================
-- END OF MIGRATION
-- =====================================================
