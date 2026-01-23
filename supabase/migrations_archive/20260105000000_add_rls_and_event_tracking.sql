-- Migration: Add RLS policies and event tracking for microservice integration
-- This ensures proper tenant isolation and event processing idempotency

-- =====================================================
-- CREATE PROCESSED EVENTS TABLE (Idempotency Tracking)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.processed_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_id UUID UNIQUE NOT NULL,
    event_type TEXT NOT NULL,
    tenant_id UUID NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payload JSONB NULL
);

CREATE INDEX idx_processed_events_delivery_id ON public.processed_events(delivery_id);
CREATE INDEX idx_processed_events_event_type ON public.processed_events(event_type);
CREATE INDEX idx_processed_events_processed_at ON public.processed_events(processed_at DESC);

COMMENT ON TABLE public.processed_events IS 'Tracks processed events from Core to prevent duplicate processing';

-- =====================================================
-- CREATE SESSION CONTEXT FUNCTION
-- =====================================================
CREATE OR REPLACE FUNCTION public.set_session_context(
  p_tenant_id UUID,
  p_user_id UUID,
  p_role TEXT
) RETURNS void AS $$
BEGIN
  PERFORM set_config('app.current_tenant_id', p_tenant_id::TEXT, false);
  PERFORM set_config('app.current_user_id', p_user_id::TEXT, false);
  PERFORM set_config('app.user_role', p_role, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.set_session_context IS 'Sets session variables for RLS policies';

-- =====================================================
-- ENABLE RLS ON ALL INVENTORY TABLES
-- =====================================================

-- Config tables (dashboards already have RLS in their migrations)
-- Locations and warehouses will be created if they exist

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'locations') THEN
        ALTER TABLE inventory.locations ENABLE ROW LEVEL SECURITY;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'warehouses') THEN
        ALTER TABLE inventory.warehouses ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;

-- Reference tables
ALTER TABLE inventory.item_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.assets ENABLE ROW LEVEL SECURITY;

-- Event ledger tables
ALTER TABLE inventory.inventory_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.asset_events ENABLE ROW LEVEL SECURITY;

-- Read model tables
ALTER TABLE inventory.stock_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.asset_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.daily_item_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.daily_asset_metrics ENABLE ROW LEVEL SECURITY;

-- Purchasing and cycle count tables (if they exist)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'po_headers') THEN
        ALTER TABLE inventory.po_headers ENABLE ROW LEVEL SECURITY;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'po_lines') THEN
        ALTER TABLE inventory.po_lines ENABLE ROW LEVEL SECURITY;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'cycle_count_batches') THEN
        ALTER TABLE inventory.cycle_count_batches ENABLE ROW LEVEL SECURITY;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'cycle_count_lines') THEN
        ALTER TABLE inventory.cycle_count_lines ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;

-- =====================================================
-- CREATE RLS POLICIES - Tenant Isolation
-- =====================================================

-- Helper function to get current tenant from session
CREATE OR REPLACE FUNCTION public.current_tenant_id() RETURNS UUID AS $$
BEGIN
  RETURN NULLIF(current_setting('app.current_tenant_id', true), '')::UUID;
END;
$$ LANGUAGE plpgsql STABLE;

-- Locations Policies (if table exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'locations') THEN
        DROP POLICY IF EXISTS "locations_tenant_isolation" ON inventory.locations;
        CREATE POLICY "locations_tenant_isolation"
        ON inventory.locations
        FOR ALL
        TO authenticated
        USING (tenant_id = public.current_tenant_id())
        WITH CHECK (tenant_id = public.current_tenant_id());

        DROP POLICY IF EXISTS "locations_service_role" ON inventory.locations;
        CREATE POLICY "locations_service_role"
        ON inventory.locations
        FOR ALL
        TO service_role
        USING (true)
        WITH CHECK (true);
    END IF;
END $$;

-- Warehouses Policies (if table exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'warehouses') THEN
        DROP POLICY IF EXISTS "warehouses_tenant_isolation" ON inventory.warehouses;
        CREATE POLICY "warehouses_tenant_isolation"
        ON inventory.warehouses
        FOR ALL
        TO authenticated
        USING (tenant_id = public.current_tenant_id())
        WITH CHECK (tenant_id = public.current_tenant_id());

        DROP POLICY IF EXISTS "warehouses_service_role" ON inventory.warehouses;
        CREATE POLICY "warehouses_service_role"
        ON inventory.warehouses
        FOR ALL
        TO service_role
        USING (true)
        WITH CHECK (true);
    END IF;
END $$;

-- Item Categories Policies
DROP POLICY IF EXISTS "item_categories_tenant_isolation" ON inventory.item_categories;
CREATE POLICY "item_categories_tenant_isolation"
ON inventory.item_categories
FOR ALL
TO authenticated
USING (tenant_id = public.current_tenant_id())
WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "item_categories_service_role" ON inventory.item_categories;
CREATE POLICY "item_categories_service_role"
ON inventory.item_categories
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Catalog Items Policies
DROP POLICY IF EXISTS "catalog_items_tenant_isolation" ON inventory.catalog_items;
CREATE POLICY "catalog_items_tenant_isolation"
ON inventory.catalog_items
FOR ALL
TO authenticated
USING (tenant_id = public.current_tenant_id())
WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "catalog_items_service_role" ON inventory.catalog_items;
CREATE POLICY "catalog_items_service_role"
ON inventory.catalog_items
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Assets Policies
DROP POLICY IF EXISTS "assets_tenant_isolation" ON inventory.assets;
CREATE POLICY "assets_tenant_isolation"
ON inventory.assets
FOR ALL
TO authenticated
USING (tenant_id = public.current_tenant_id())
WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "assets_service_role" ON inventory.assets;
CREATE POLICY "assets_service_role"
ON inventory.assets
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Inventory Events Policies
DROP POLICY IF EXISTS "inventory_events_tenant_isolation" ON inventory.inventory_events;
CREATE POLICY "inventory_events_tenant_isolation"
ON inventory.inventory_events
FOR ALL
TO authenticated
USING (tenant_id = public.current_tenant_id())
WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "inventory_events_service_role" ON inventory.inventory_events;
CREATE POLICY "inventory_events_service_role"
ON inventory.inventory_events
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Asset Events Policies
DROP POLICY IF EXISTS "asset_events_tenant_isolation" ON inventory.asset_events;
CREATE POLICY "asset_events_tenant_isolation"
ON inventory.asset_events
FOR ALL
TO authenticated
USING (tenant_id = public.current_tenant_id())
WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "asset_events_service_role" ON inventory.asset_events;
CREATE POLICY "asset_events_service_role"
ON inventory.asset_events
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Stock Balances Policies
DROP POLICY IF EXISTS "stock_balances_tenant_isolation" ON inventory.stock_balances;
CREATE POLICY "stock_balances_tenant_isolation"
ON inventory.stock_balances
FOR ALL
TO authenticated
USING (tenant_id = public.current_tenant_id())
WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "stock_balances_service_role" ON inventory.stock_balances;
CREATE POLICY "stock_balances_service_role"
ON inventory.stock_balances
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Reservations Policies
DROP POLICY IF EXISTS "reservations_tenant_isolation" ON inventory.reservations;
CREATE POLICY "reservations_tenant_isolation"
ON inventory.reservations
FOR ALL
TO authenticated
USING (tenant_id = public.current_tenant_id())
WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "reservations_service_role" ON inventory.reservations;
CREATE POLICY "reservations_service_role"
ON inventory.reservations
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Asset State Policies
DROP POLICY IF EXISTS "asset_state_tenant_isolation" ON inventory.asset_state;
CREATE POLICY "asset_state_tenant_isolation"
ON inventory.asset_state
FOR ALL
TO authenticated
USING (tenant_id = public.current_tenant_id())
WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "asset_state_service_role" ON inventory.asset_state;
CREATE POLICY "asset_state_service_role"
ON inventory.asset_state
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Daily Item Activity Policies
DROP POLICY IF EXISTS "daily_item_activity_tenant_isolation" ON inventory.daily_item_activity;
CREATE POLICY "daily_item_activity_tenant_isolation"
ON inventory.daily_item_activity
FOR ALL
TO authenticated
USING (tenant_id = public.current_tenant_id())
WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "daily_item_activity_service_role" ON inventory.daily_item_activity;
CREATE POLICY "daily_item_activity_service_role"
ON inventory.daily_item_activity
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Daily Asset Metrics Policies
DROP POLICY IF EXISTS "daily_asset_metrics_tenant_isolation" ON inventory.daily_asset_metrics;
CREATE POLICY "daily_asset_metrics_tenant_isolation"
ON inventory.daily_asset_metrics
FOR ALL
TO authenticated
USING (tenant_id = public.current_tenant_id())
WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "daily_asset_metrics_service_role" ON inventory.daily_asset_metrics;
CREATE POLICY "daily_asset_metrics_service_role"
ON inventory.daily_asset_metrics
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- =====================================================
-- PURCHASING & CYCLE COUNT TABLES (Conditional)
-- =====================================================

-- PO Headers
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'po_headers') THEN
        DROP POLICY IF EXISTS "po_headers_tenant_isolation" ON inventory.po_headers;
        CREATE POLICY "po_headers_tenant_isolation"
        ON inventory.po_headers
        FOR ALL
        TO authenticated
        USING (tenant_id = public.current_tenant_id())
        WITH CHECK (tenant_id = public.current_tenant_id());
        
        DROP POLICY IF EXISTS "po_headers_service_role" ON inventory.po_headers;
        CREATE POLICY "po_headers_service_role"
        ON inventory.po_headers
        FOR ALL
        TO service_role
        USING (true)
        WITH CHECK (true);
    END IF;
END $$;

-- PO Lines
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'po_lines') THEN
        DROP POLICY IF EXISTS "po_lines_tenant_isolation" ON inventory.po_lines;
        CREATE POLICY "po_lines_tenant_isolation"
        ON inventory.po_lines
        FOR ALL
        TO authenticated
        USING (tenant_id = public.current_tenant_id())
        WITH CHECK (tenant_id = public.current_tenant_id());
        
        DROP POLICY IF EXISTS "po_lines_service_role" ON inventory.po_lines;
        CREATE POLICY "po_lines_service_role"
        ON inventory.po_lines
        FOR ALL
        TO service_role
        USING (true)
        WITH CHECK (true);
    END IF;
END $$;

-- Cycle Count Batches
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'cycle_count_batches') THEN
        DROP POLICY IF EXISTS "cycle_count_batches_tenant_isolation" ON inventory.cycle_count_batches;
        CREATE POLICY "cycle_count_batches_tenant_isolation"
        ON inventory.cycle_count_batches
        FOR ALL
        TO authenticated
        USING (tenant_id = public.current_tenant_id())
        WITH CHECK (tenant_id = public.current_tenant_id());
        
        DROP POLICY IF EXISTS "cycle_count_batches_service_role" ON inventory.cycle_count_batches;
        CREATE POLICY "cycle_count_batches_service_role"
        ON inventory.cycle_count_batches
        FOR ALL
        TO service_role
        USING (true)
        WITH CHECK (true);
    END IF;
END $$;

-- Cycle Count Lines
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'cycle_count_lines') THEN
        DROP POLICY IF EXISTS "cycle_count_lines_tenant_isolation" ON inventory.cycle_count_lines;
        CREATE POLICY "cycle_count_lines_tenant_isolation"
        ON inventory.cycle_count_lines
        FOR ALL
        TO authenticated
        USING (tenant_id = public.current_tenant_id())
        WITH CHECK (tenant_id = public.current_tenant_id());
        
        DROP POLICY IF EXISTS "cycle_count_lines_service_role" ON inventory.cycle_count_lines;
        CREATE POLICY "cycle_count_lines_service_role"
        ON inventory.cycle_count_lines
        FOR ALL
        TO service_role
        USING (true)
        WITH CHECK (true);
    END IF;
END $$;

-- =====================================================
-- GRANT PERMISSIONS
-- =====================================================

-- Grant execute on session context function
GRANT EXECUTE ON FUNCTION public.set_session_context TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_session_context TO service_role;
GRANT EXECUTE ON FUNCTION public.current_tenant_id TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_tenant_id TO service_role;

-- Grant permissions on processed_events table
GRANT SELECT, INSERT ON public.processed_events TO service_role;
GRANT SELECT ON public.processed_events TO authenticated;

COMMENT ON TABLE public.processed_events IS 'Idempotency tracking for events received from Summit One Core';
