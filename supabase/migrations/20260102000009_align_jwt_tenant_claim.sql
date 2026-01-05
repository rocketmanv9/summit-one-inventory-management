-- Migration: Align tenant_id claim to app_metadata for Core SSO tokens
-- Core issues tenant_id inside app_metadata, not as a top-level claim.

-- =====================================================
-- UPDATE TENANT ISOLATION POLICIES (EXCLUDING EVENTS OUTBOX)
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
          AND tablename <> 'events_outbox'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
            r.policyname, r.schemaname, r.tablename);

        EXECUTE format(
            'CREATE POLICY %I ON %I.%I FOR ALL USING (tenant_id = (auth.jwt() -> ''app_metadata'' ->> ''tenant_id'')::uuid)',
            r.policyname, r.schemaname, r.tablename
        );
    END LOOP;
END $$;

-- =====================================================
-- UPDATE ROLE-BASED POLICIES
-- =====================================================
DROP POLICY IF EXISTS catalog_items_delete_admin_only ON inventory.catalog_items;
CREATE POLICY catalog_items_delete_admin_only ON inventory.catalog_items
    FOR DELETE
    USING (
        tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
        AND (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    );

DROP POLICY IF EXISTS purchase_orders_update_admin_or_draft ON inventory.purchase_orders;
CREATE POLICY purchase_orders_update_admin_or_draft ON inventory.purchase_orders
    FOR UPDATE
    USING (
        tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
        AND (
            status = 'draft'
            OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
        )
    );

-- =====================================================
-- UPDATE EVENTS OUTBOX POLICY
-- =====================================================
DROP POLICY IF EXISTS events_outbox_tenant_isolation ON inventory.events_outbox;
CREATE POLICY events_outbox_tenant_isolation ON inventory.events_outbox
    FOR ALL
    USING (
        scope = 'global'
        OR (scope = 'tenant'
            AND tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid)
        OR (scope = 'profile' AND actor_user_id = auth.uid())
    );
