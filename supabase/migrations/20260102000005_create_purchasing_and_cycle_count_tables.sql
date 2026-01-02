-- Migration: Create optional tables (purchasing & cycle counting)
-- Add these when purchasing and cycle count features enter scope

-- =====================================================
-- PURCHASE ORDERS TABLE
-- =====================================================
CREATE TABLE inventory.purchase_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    po_number TEXT NOT NULL,
    vendor_location_id UUID NULL REFERENCES inventory.locations(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'in_transit', 'partially_received', 'received', 'cancelled', 'closed')),
    order_date DATE NOT NULL,
    expected_delivery_date DATE NULL,
    delivery_location_id UUID NULL REFERENCES inventory.locations(id) ON DELETE SET NULL,
    notes TEXT NULL,
    created_by_user_id UUID NULL,
    approved_by_user_id UUID NULL,
    approved_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Unique constraint
    CONSTRAINT purchase_orders_tenant_po_number_unique UNIQUE (tenant_id, po_number)
);

-- Indexes for purchase_orders
CREATE INDEX idx_purchase_orders_tenant_id ON inventory.purchase_orders(tenant_id);
CREATE INDEX idx_purchase_orders_vendor_location_id ON inventory.purchase_orders(vendor_location_id) WHERE vendor_location_id IS NOT NULL;
CREATE INDEX idx_purchase_orders_status ON inventory.purchase_orders(tenant_id, status);
CREATE INDEX idx_purchase_orders_order_date ON inventory.purchase_orders(tenant_id, order_date DESC);
CREATE INDEX idx_purchase_orders_expected_delivery_date ON inventory.purchase_orders(tenant_id, expected_delivery_date) WHERE expected_delivery_date IS NOT NULL;

-- =====================================================
-- PURCHASE ORDER LINES TABLE
-- =====================================================
CREATE TABLE inventory.purchase_order_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    po_id UUID NOT NULL REFERENCES inventory.purchase_orders(id) ON DELETE CASCADE,
    line_number INTEGER NOT NULL,
    catalog_item_id UUID NOT NULL REFERENCES inventory.catalog_items(id) ON DELETE RESTRICT,
    qty_ordered NUMERIC(18, 4) NOT NULL,
    qty_received NUMERIC(18, 4) NOT NULL DEFAULT 0,
    unit_cost NUMERIC(18, 4) NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'partially_received', 'received', 'cancelled')),
    notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Unique constraint
    CONSTRAINT purchase_order_lines_po_line_unique UNIQUE (po_id, line_number),
    
    -- Check constraints
    CONSTRAINT purchase_order_lines_qty_ordered_check CHECK (qty_ordered > 0),
    CONSTRAINT purchase_order_lines_qty_received_check CHECK (qty_received >= 0),
    CONSTRAINT purchase_order_lines_qty_received_not_exceed CHECK (qty_received <= qty_ordered)
);

-- Indexes for purchase_order_lines
CREATE INDEX idx_purchase_order_lines_tenant_id ON inventory.purchase_order_lines(tenant_id);
CREATE INDEX idx_purchase_order_lines_po_id ON inventory.purchase_order_lines(po_id);
CREATE INDEX idx_purchase_order_lines_catalog_item_id ON inventory.purchase_order_lines(catalog_item_id);
CREATE INDEX idx_purchase_order_lines_status ON inventory.purchase_order_lines(tenant_id, status);

-- =====================================================
-- RECEIPTS TABLE
-- =====================================================
CREATE TABLE inventory.receipts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    po_id UUID NULL REFERENCES inventory.purchase_orders(id) ON DELETE SET NULL,
    receipt_number TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    received_by_user_id UUID NULL,
    location_id UUID NOT NULL REFERENCES inventory.locations(id) ON DELETE RESTRICT,
    last_event_id TEXT NOT NULL, -- ✅ Idempotency key
    notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Unique constraints
    CONSTRAINT receipts_tenant_receipt_number_unique UNIQUE (tenant_id, receipt_number),
    CONSTRAINT receipts_tenant_last_event_id_unique UNIQUE (tenant_id, last_event_id)
);

-- Indexes for receipts
CREATE INDEX idx_receipts_tenant_id ON inventory.receipts(tenant_id);
CREATE INDEX idx_receipts_po_id ON inventory.receipts(po_id) WHERE po_id IS NOT NULL;
CREATE INDEX idx_receipts_received_at ON inventory.receipts(tenant_id, received_at DESC);
CREATE INDEX idx_receipts_location_id ON inventory.receipts(location_id);

-- =====================================================
-- RECEIPT LINES TABLE
-- =====================================================
CREATE TABLE inventory.receipt_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    receipt_id UUID NOT NULL REFERENCES inventory.receipts(id) ON DELETE CASCADE,
    po_line_id UUID NULL REFERENCES inventory.purchase_order_lines(id) ON DELETE SET NULL,
    line_number INTEGER NOT NULL,
    catalog_item_id UUID NOT NULL REFERENCES inventory.catalog_items(id) ON DELETE RESTRICT,
    qty_received NUMERIC(18, 4) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Unique constraint
    CONSTRAINT receipt_lines_receipt_line_unique UNIQUE (receipt_id, line_number),
    
    -- Check constraint
    CONSTRAINT receipt_lines_qty_received_check CHECK (qty_received > 0)
);

-- Indexes for receipt_lines
CREATE INDEX idx_receipt_lines_tenant_id ON inventory.receipt_lines(tenant_id);
CREATE INDEX idx_receipt_lines_receipt_id ON inventory.receipt_lines(receipt_id);
CREATE INDEX idx_receipt_lines_po_line_id ON inventory.receipt_lines(po_line_id) WHERE po_line_id IS NOT NULL;
CREATE INDEX idx_receipt_lines_catalog_item_id ON inventory.receipt_lines(catalog_item_id);

-- =====================================================
-- CYCLE COUNTS TABLE
-- =====================================================
CREATE TABLE inventory.cycle_counts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    count_number TEXT NOT NULL,
    location_id UUID NULL REFERENCES inventory.locations(id) ON DELETE SET NULL,
    scheduled_for DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
    counted_by_user_id UUID NULL,
    started_at TIMESTAMPTZ NULL,
    completed_at TIMESTAMPTZ NULL,
    notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Unique constraint
    CONSTRAINT cycle_counts_tenant_count_number_unique UNIQUE (tenant_id, count_number)
);

-- Indexes for cycle_counts
CREATE INDEX idx_cycle_counts_tenant_id ON inventory.cycle_counts(tenant_id);
CREATE INDEX idx_cycle_counts_location_id ON inventory.cycle_counts(location_id) WHERE location_id IS NOT NULL;
CREATE INDEX idx_cycle_counts_scheduled_for ON inventory.cycle_counts(tenant_id, scheduled_for);
CREATE INDEX idx_cycle_counts_status ON inventory.cycle_counts(tenant_id, status);

-- =====================================================
-- CYCLE COUNT LINES TABLE
-- =====================================================
CREATE TABLE inventory.cycle_count_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    cycle_count_id UUID NOT NULL REFERENCES inventory.cycle_counts(id) ON DELETE CASCADE,
    line_number INTEGER NOT NULL,
    catalog_item_id UUID NOT NULL REFERENCES inventory.catalog_items(id) ON DELETE RESTRICT,
    location_id UUID NOT NULL REFERENCES inventory.locations(id) ON DELETE RESTRICT,
    qty_expected NUMERIC(18, 4) NULL, -- Null if blind count
    qty_counted NUMERIC(18, 4) NULL, -- Null until counted
    variance NUMERIC(18, 4) GENERATED ALWAYS AS (COALESCE(qty_counted, 0) - COALESCE(qty_expected, 0)) STORED,
    variance_pct NUMERIC(10, 2) NULL, -- Calculated percentage variance
    counted_at TIMESTAMPTZ NULL,
    notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Unique constraint
    CONSTRAINT cycle_count_lines_count_line_unique UNIQUE (cycle_count_id, line_number)
);

-- Indexes for cycle_count_lines
CREATE INDEX idx_cycle_count_lines_tenant_id ON inventory.cycle_count_lines(tenant_id);
CREATE INDEX idx_cycle_count_lines_cycle_count_id ON inventory.cycle_count_lines(cycle_count_id);
CREATE INDEX idx_cycle_count_lines_catalog_item_id ON inventory.cycle_count_lines(catalog_item_id);
CREATE INDEX idx_cycle_count_lines_location_id ON inventory.cycle_count_lines(location_id);
CREATE INDEX idx_cycle_count_lines_variance ON inventory.cycle_count_lines(tenant_id, variance) WHERE variance != 0;

-- =====================================================
-- RLS POLICIES - PURCHASE_ORDERS
-- =====================================================
ALTER TABLE inventory.purchase_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY purchase_orders_tenant_isolation ON inventory.purchase_orders
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

-- =====================================================
-- RLS POLICIES - PURCHASE_ORDER_LINES
-- =====================================================
ALTER TABLE inventory.purchase_order_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY purchase_order_lines_tenant_isolation ON inventory.purchase_order_lines
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

-- =====================================================
-- RLS POLICIES - RECEIPTS
-- =====================================================
ALTER TABLE inventory.receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY receipts_tenant_isolation ON inventory.receipts
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

-- =====================================================
-- RLS POLICIES - RECEIPT_LINES
-- =====================================================
ALTER TABLE inventory.receipt_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY receipt_lines_tenant_isolation ON inventory.receipt_lines
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

-- =====================================================
-- RLS POLICIES - CYCLE_COUNTS
-- =====================================================
ALTER TABLE inventory.cycle_counts ENABLE ROW LEVEL SECURITY;

CREATE POLICY cycle_counts_tenant_isolation ON inventory.cycle_counts
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

-- =====================================================
-- RLS POLICIES - CYCLE_COUNT_LINES
-- =====================================================
ALTER TABLE inventory.cycle_count_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY cycle_count_lines_tenant_isolation ON inventory.cycle_count_lines
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

-- =====================================================
-- UPDATED_AT TRIGGERS
-- =====================================================
CREATE TRIGGER update_purchase_orders_updated_at
    BEFORE UPDATE ON inventory.purchase_orders
    FOR EACH ROW
    EXECUTE FUNCTION inventory.update_updated_at_column();

CREATE TRIGGER update_purchase_order_lines_updated_at
    BEFORE UPDATE ON inventory.purchase_order_lines
    FOR EACH ROW
    EXECUTE FUNCTION inventory.update_updated_at_column();

CREATE TRIGGER update_receipts_updated_at
    BEFORE UPDATE ON inventory.receipts
    FOR EACH ROW
    EXECUTE FUNCTION inventory.update_updated_at_column();

CREATE TRIGGER update_receipt_lines_updated_at
    BEFORE UPDATE ON inventory.receipt_lines
    FOR EACH ROW
    EXECUTE FUNCTION inventory.update_updated_at_column();

CREATE TRIGGER update_cycle_counts_updated_at
    BEFORE UPDATE ON inventory.cycle_counts
    FOR EACH ROW
    EXECUTE FUNCTION inventory.update_updated_at_column();

CREATE TRIGGER update_cycle_count_lines_updated_at
    BEFORE UPDATE ON inventory.cycle_count_lines
    FOR EACH ROW
    EXECUTE FUNCTION inventory.update_updated_at_column();

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Function to update PO line status based on quantities
CREATE OR REPLACE FUNCTION inventory.update_po_line_status()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.qty_received = 0 THEN
        NEW.status := 'pending';
    ELSIF NEW.qty_received >= NEW.qty_ordered THEN
        NEW.status := 'received';
    ELSE
        NEW.status := 'partially_received';
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_po_line_status_trigger
    BEFORE INSERT OR UPDATE OF qty_received, qty_ordered ON inventory.purchase_order_lines
    FOR EACH ROW
    EXECUTE FUNCTION inventory.update_po_line_status();

-- Function to update PO status based on line statuses
CREATE OR REPLACE FUNCTION inventory.update_po_status()
RETURNS TRIGGER AS $$
DECLARE
    v_all_received BOOLEAN;
    v_any_received BOOLEAN;
BEGIN
    -- Check if all lines are received
    SELECT 
        BOOL_AND(status = 'received'),
        BOOL_OR(status IN ('received', 'partially_received'))
    INTO v_all_received, v_any_received
    FROM inventory.purchase_order_lines
    WHERE po_id = COALESCE(NEW.po_id, OLD.po_id);
    
    -- Update PO status
    UPDATE inventory.purchase_orders
    SET status = CASE
        WHEN v_all_received THEN 'received'
        WHEN v_any_received THEN 'partially_received'
        ELSE status
    END
    WHERE id = COALESCE(NEW.po_id, OLD.po_id);
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_po_status_trigger
    AFTER INSERT OR UPDATE OR DELETE ON inventory.purchase_order_lines
    FOR EACH ROW
    EXECUTE FUNCTION inventory.update_po_status();

-- =====================================================
-- COMMENTS
-- =====================================================
COMMENT ON TABLE inventory.purchase_orders IS 'Purchase orders for procuring inventory';
COMMENT ON TABLE inventory.purchase_order_lines IS 'Line items on purchase orders';
COMMENT ON TABLE inventory.receipts IS 'Physical receipts of inventory - linked to events via last_event_id';
COMMENT ON TABLE inventory.receipt_lines IS 'Line items on receipts';
COMMENT ON TABLE inventory.cycle_counts IS 'Scheduled inventory cycle counts for accuracy verification';
COMMENT ON TABLE inventory.cycle_count_lines IS 'Individual items counted during cycle counts';
COMMENT ON COLUMN inventory.receipts.last_event_id IS 'Idempotency key linking to inventory_events';
COMMENT ON COLUMN inventory.cycle_count_lines.variance IS 'Computed as qty_counted - qty_expected';
