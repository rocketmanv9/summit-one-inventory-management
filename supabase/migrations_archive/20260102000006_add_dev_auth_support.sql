-- Migration: Production RLS policies with strict tenant isolation
-- NO bypasses - requires proper JWT with tenant_id claim

-- =====================================================
-- DROP OLD BYPASS POLICIES
-- =====================================================
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN 
        SELECT schemaname, tablename, policyname 
        FROM pg_policies 
        WHERE schemaname = 'inventory' 
        AND policyname LIKE '%tenant_isolation%'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', 
            r.policyname, r.schemaname, r.tablename);
    END LOOP;
END $$;

-- =====================================================
-- STRICT RLS POLICIES - TENANT ISOLATION
-- =====================================================
-- Format: tenant_id = (auth.jwt() ->> 'tenant_id')::uuid

CREATE POLICY dashboards_tenant_isolation ON inventory.dashboards
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY dashboard_widgets_tenant_isolation ON inventory.dashboard_widgets
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY item_categories_tenant_isolation ON inventory.item_categories
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY catalog_items_tenant_isolation ON inventory.catalog_items
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY locations_tenant_isolation ON inventory.locations
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY assets_tenant_isolation ON inventory.assets
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY identifiers_tenant_isolation ON inventory.identifiers
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY inventory_events_tenant_isolation ON inventory.inventory_events
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY asset_events_tenant_isolation ON inventory.asset_events
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY procurement_events_tenant_isolation ON inventory.procurement_events
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY stock_balances_tenant_isolation ON inventory.stock_balances
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY reservations_tenant_isolation ON inventory.reservations
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY asset_state_tenant_isolation ON inventory.asset_state
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY daily_item_activity_tenant_isolation ON inventory.daily_item_activity
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY daily_asset_metrics_tenant_isolation ON inventory.daily_asset_metrics
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY purchase_orders_tenant_isolation ON inventory.purchase_orders
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY purchase_order_lines_tenant_isolation ON inventory.purchase_order_lines
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY receipts_tenant_isolation ON inventory.receipts
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY receipt_lines_tenant_isolation ON inventory.receipt_lines
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY cycle_counts_tenant_isolation ON inventory.cycle_counts
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY cycle_count_lines_tenant_isolation ON inventory.cycle_count_lines
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- =====================================================
-- ROLE-BASED POLICIES (Optional - add as needed)
-- =====================================================

-- Example: Only admins can delete catalog items
CREATE POLICY catalog_items_delete_admin_only ON inventory.catalog_items
    FOR DELETE
    USING (
        tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
        AND (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    );

-- Example: Only admins can modify purchase orders after approval
CREATE POLICY purchase_orders_update_admin_or_draft ON inventory.purchase_orders
    FOR UPDATE
    USING (
        tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
        AND (
            status = 'draft'
            OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
        )
    );

-- =====================================================
-- COMMENTS
-- =====================================================
COMMENT ON POLICY dashboards_tenant_isolation ON inventory.dashboards IS 'Strict tenant isolation via JWT tenant_id claim';
COMMENT ON POLICY catalog_items_delete_admin_only ON inventory.catalog_items IS 'Only admins can delete catalog items';
