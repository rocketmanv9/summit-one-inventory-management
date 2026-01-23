-- ============================================================================
-- FIX: Revert catalog_items RLS policy that's blocking access
-- ============================================================================
-- Issue: The deleted_at check in RLS is preventing access for all users
-- Solution: Keep soft delete filtering in queries, not in RLS policy
-- ============================================================================

DO $$ BEGIN
    RAISE NOTICE '=== Fixing catalog_items RLS Policy ===';
END $$;

-- Revert to original RLS policy without deleted_at check
-- The deleted_at filtering should happen in application queries, not RLS
DROP POLICY IF EXISTS catalog_items_tenant_isolation ON inventory.catalog_items;

CREATE POLICY catalog_items_tenant_isolation ON inventory.catalog_items
    FOR ALL
    USING (
        tenant_id = (auth.jwt() ->> 'tenant_id')::UUID
    );

-- Keep service role policy unchanged
DROP POLICY IF EXISTS catalog_items_service_role_all ON inventory.catalog_items;
CREATE POLICY catalog_items_service_role_all ON inventory.catalog_items
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

COMMENT ON POLICY catalog_items_tenant_isolation ON inventory.catalog_items IS 
    'Tenant isolation via JWT claim - soft delete filtering done in application layer';

DO $$ BEGIN
    RAISE NOTICE '✓ catalog_items RLS policy fixed';
    RAISE NOTICE '  - Removed deleted_at check from RLS (application layer handles this)';
    RAISE NOTICE '  - Tenant isolation still enforced via JWT';
END $$;
