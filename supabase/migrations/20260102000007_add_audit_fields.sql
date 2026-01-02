-- Migration: Add audit fields to all tables
-- Adds created_by, updated_by for proper user tracking

-- =====================================================
-- ADD AUDIT COLUMNS TO EXISTING TABLES
-- =====================================================

-- Dashboards
ALTER TABLE inventory.dashboards 
    ADD COLUMN created_by UUID REFERENCES auth.users(id),
    ADD COLUMN updated_by UUID REFERENCES auth.users(id);

-- Dashboard Widgets
ALTER TABLE inventory.dashboard_widgets 
    ADD COLUMN created_by UUID REFERENCES auth.users(id),
    ADD COLUMN updated_by UUID REFERENCES auth.users(id);

-- Item Categories
ALTER TABLE inventory.item_categories 
    ADD COLUMN created_by UUID REFERENCES auth.users(id),
    ADD COLUMN updated_by UUID REFERENCES auth.users(id);

-- Catalog Items
ALTER TABLE inventory.catalog_items 
    ADD COLUMN created_by UUID REFERENCES auth.users(id),
    ADD COLUMN updated_by UUID REFERENCES auth.users(id);

-- Locations
ALTER TABLE inventory.locations 
    ADD COLUMN created_by UUID REFERENCES auth.users(id),
    ADD COLUMN updated_by UUID REFERENCES auth.users(id);

-- Assets
ALTER TABLE inventory.assets 
    ADD COLUMN created_by UUID REFERENCES auth.users(id),
    ADD COLUMN updated_by UUID REFERENCES auth.users(id);

-- Identifiers
ALTER TABLE inventory.identifiers 
    ADD COLUMN created_by UUID REFERENCES auth.users(id),
    ADD COLUMN updated_by UUID REFERENCES auth.users(id);

-- Stock Balances
ALTER TABLE inventory.stock_balances 
    ADD COLUMN updated_by UUID REFERENCES auth.users(id);

-- Reservations
ALTER TABLE inventory.reservations 
    ADD COLUMN created_by UUID REFERENCES auth.users(id),
    ADD COLUMN updated_by UUID REFERENCES auth.users(id);

-- Asset State
ALTER TABLE inventory.asset_state 
    ADD COLUMN updated_by UUID REFERENCES auth.users(id);

-- Purchase Orders
ALTER TABLE inventory.purchase_orders 
    ADD COLUMN updated_by UUID REFERENCES auth.users(id);

-- Purchase Order Lines
ALTER TABLE inventory.purchase_order_lines 
    ADD COLUMN created_by UUID REFERENCES auth.users(id),
    ADD COLUMN updated_by UUID REFERENCES auth.users(id);

-- Receipts
ALTER TABLE inventory.receipts 
    ADD COLUMN created_by UUID REFERENCES auth.users(id),
    ADD COLUMN updated_by UUID REFERENCES auth.users(id);

-- Receipt Lines
ALTER TABLE inventory.receipt_lines 
    ADD COLUMN created_by UUID REFERENCES auth.users(id),
    ADD COLUMN updated_by UUID REFERENCES auth.users(id);

-- Cycle Counts
ALTER TABLE inventory.cycle_counts 
    ADD COLUMN created_by UUID REFERENCES auth.users(id),
    ADD COLUMN updated_by UUID REFERENCES auth.users(id);

-- Cycle Count Lines
ALTER TABLE inventory.cycle_count_lines 
    ADD COLUMN created_by UUID REFERENCES auth.users(id),
    ADD COLUMN updated_by UUID REFERENCES auth.users(id);

-- Daily Item Activity
ALTER TABLE inventory.daily_item_activity 
    ADD COLUMN updated_by UUID REFERENCES auth.users(id);

-- Daily Asset Metrics
ALTER TABLE inventory.daily_asset_metrics 
    ADD COLUMN updated_by UUID REFERENCES auth.users(id);

-- =====================================================
-- TRIGGERS TO AUTO-SET AUDIT FIELDS
-- =====================================================

CREATE OR REPLACE FUNCTION inventory.set_audit_fields()
RETURNS TRIGGER AS $$
BEGIN
    -- On INSERT, set created_by from auth.uid()
    IF TG_OP = 'INSERT' THEN
        NEW.created_by = auth.uid();
        NEW.updated_by = auth.uid();
    -- On UPDATE, only update updated_by
    ELSIF TG_OP = 'UPDATE' THEN
        NEW.updated_by = auth.uid();
        -- Prevent changing created_by
        IF OLD.created_by IS NOT NULL THEN
            NEW.created_by = OLD.created_by;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply triggers to all tables with audit fields
CREATE TRIGGER set_dashboards_audit BEFORE INSERT OR UPDATE ON inventory.dashboards FOR EACH ROW EXECUTE FUNCTION inventory.set_audit_fields();
CREATE TRIGGER set_dashboard_widgets_audit BEFORE INSERT OR UPDATE ON inventory.dashboard_widgets FOR EACH ROW EXECUTE FUNCTION inventory.set_audit_fields();
CREATE TRIGGER set_item_categories_audit BEFORE INSERT OR UPDATE ON inventory.item_categories FOR EACH ROW EXECUTE FUNCTION inventory.set_audit_fields();
CREATE TRIGGER set_catalog_items_audit BEFORE INSERT OR UPDATE ON inventory.catalog_items FOR EACH ROW EXECUTE FUNCTION inventory.set_audit_fields();
CREATE TRIGGER set_locations_audit BEFORE INSERT OR UPDATE ON inventory.locations FOR EACH ROW EXECUTE FUNCTION inventory.set_audit_fields();
CREATE TRIGGER set_assets_audit BEFORE INSERT OR UPDATE ON inventory.assets FOR EACH ROW EXECUTE FUNCTION inventory.set_audit_fields();
CREATE TRIGGER set_identifiers_audit BEFORE INSERT OR UPDATE ON inventory.identifiers FOR EACH ROW EXECUTE FUNCTION inventory.set_audit_fields();
CREATE TRIGGER set_reservations_audit BEFORE INSERT OR UPDATE ON inventory.reservations FOR EACH ROW EXECUTE FUNCTION inventory.set_audit_fields();
CREATE TRIGGER set_purchase_order_lines_audit BEFORE INSERT OR UPDATE ON inventory.purchase_order_lines FOR EACH ROW EXECUTE FUNCTION inventory.set_audit_fields();
CREATE TRIGGER set_receipts_audit BEFORE INSERT OR UPDATE ON inventory.receipts FOR EACH ROW EXECUTE FUNCTION inventory.set_audit_fields();
CREATE TRIGGER set_receipt_lines_audit BEFORE INSERT OR UPDATE ON inventory.receipt_lines FOR EACH ROW EXECUTE FUNCTION inventory.set_audit_fields();
CREATE TRIGGER set_cycle_counts_audit BEFORE INSERT OR UPDATE ON inventory.cycle_counts FOR EACH ROW EXECUTE FUNCTION inventory.set_audit_fields();
CREATE TRIGGER set_cycle_count_lines_audit BEFORE INSERT OR UPDATE ON inventory.cycle_count_lines FOR EACH ROW EXECUTE FUNCTION inventory.set_audit_fields();

-- =====================================================
-- ADDITIONAL INDEXES FOR AUDIT QUERIES
-- =====================================================

CREATE INDEX idx_dashboards_created_by ON inventory.dashboards(created_by) WHERE created_by IS NOT NULL;
CREATE INDEX idx_catalog_items_created_by ON inventory.catalog_items(created_by) WHERE created_by IS NOT NULL;
CREATE INDEX idx_assets_created_by ON inventory.assets(created_by) WHERE created_by IS NOT NULL;
CREATE INDEX idx_inventory_events_actor ON inventory.inventory_events(actor_user_id) WHERE actor_user_id IS NOT NULL;
CREATE INDEX idx_asset_events_actor ON inventory.asset_events(actor_user_id) WHERE actor_user_id IS NOT NULL;

-- =====================================================
-- COMMENTS
-- =====================================================
COMMENT ON COLUMN inventory.dashboards.created_by IS 'User ID (auth.uid) who created this record';
COMMENT ON COLUMN inventory.dashboards.updated_by IS 'User ID (auth.uid) who last updated this record';
COMMENT ON FUNCTION inventory.set_audit_fields() IS 'Automatically sets created_by and updated_by from auth.uid()';
