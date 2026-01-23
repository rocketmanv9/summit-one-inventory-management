-- ============================================================================
-- GRANT SUPPLY CHAIN SCHEMA PERMISSIONS
-- ============================================================================
-- Date: 2026-01-23
-- Purpose: Grant service role access to supply_chain schema
-- Issue: API routes getting "permission denied for schema supply_chain"
-- ============================================================================

-- Grant schema usage
GRANT USAGE ON SCHEMA supply_chain TO postgres, authenticated, service_role;

-- Grant table permissions to service_role for vendors
GRANT SELECT, INSERT, UPDATE, DELETE ON supply_chain.vendors TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON supply_chain.vendors TO authenticated;

-- Grant table permissions for purchase_orders (used in vendor delete validation)
GRANT SELECT, INSERT, UPDATE, DELETE ON supply_chain.purchase_orders TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON supply_chain.purchase_orders TO authenticated;

-- Grant permissions on other supply_chain tables for completeness
GRANT SELECT, INSERT, UPDATE, DELETE ON supply_chain.receipts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON supply_chain.receipts TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON supply_chain.receipt_lines TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON supply_chain.receipt_lines TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON supply_chain.purchase_order_lines TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON supply_chain.purchase_order_lines TO authenticated;

-- Grant sequence permissions
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA supply_chain TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA supply_chain TO authenticated;

-- Ensure future tables also get permissions
ALTER DEFAULT PRIVILEGES IN SCHEMA supply_chain 
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA supply_chain 
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA supply_chain 
    GRANT USAGE, SELECT ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA supply_chain 
    GRANT USAGE, SELECT ON SEQUENCES TO authenticated;

-- Verification
DO $$
BEGIN
    RAISE NOTICE '✓ Granted USAGE on schema supply_chain';
    RAISE NOTICE '✓ Granted table permissions to service_role and authenticated';
    RAISE NOTICE '✓ Granted sequence permissions';
    RAISE NOTICE '✓ Set default privileges for future objects';
    RAISE NOTICE '';
    RAISE NOTICE 'Supply chain schema permissions configured successfully.';
END $$;
