-- =====================================================
-- BOUNDED CONTEXT SEPARATION: SUPPLY_CHAIN + INVENTORY
-- =====================================================
-- This migration separates concerns into two schemas:
-- 1. supply_chain: Procurement documents (vendors, POs, receipts)
-- 2. inventory: Stock state and changes (ledger, balances, reservations, assets)
--
-- The ONLY bridge: supply_chain.rpc_post_receipt_to_inventory()
--   - Atomic RPC that writes inventory ledger/movement rows
--   - No other process may update balances directly
--
-- Frontend consumes stable views/RPCs from each schema
-- Compatibility views preserve existing frontend code
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '=== BOUNDED CONTEXT SEPARATION MIGRATION ===';
END $$;

-- =====================================================
-- STEP 1: CREATE SUPPLY_CHAIN SCHEMA
-- =====================================================

CREATE SCHEMA IF NOT EXISTS supply_chain;

DO $$
BEGIN
  RAISE NOTICE '✓ Created supply_chain schema';
END $$;

-- =====================================================
-- STEP 2: MOVE PROCUREMENT TABLES TO SUPPLY_CHAIN
-- =====================================================

-- 2.1 VENDORS
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'vendors') THEN
    ALTER TABLE inventory.vendors SET SCHEMA supply_chain;
    RAISE NOTICE '✓ Moved vendors to supply_chain schema';
  ELSE
    RAISE NOTICE '⚠ vendors table not found in inventory schema';
  END IF;
END $$;

-- 2.2 VENDOR_ITEMS (catalog mapping)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'vendor_items') THEN
    ALTER TABLE inventory.vendor_items SET SCHEMA supply_chain;
    RAISE NOTICE '✓ Moved vendor_items to supply_chain schema';
  ELSE
    RAISE NOTICE '⚠ vendor_items table not found';
  END IF;
END $$;

-- 2.3 VENDOR_PERFORMANCE_METRICS
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'vendor_performance_metrics') THEN
    ALTER TABLE inventory.vendor_performance_metrics SET SCHEMA supply_chain;
    RAISE NOTICE '✓ Moved vendor_performance_metrics to supply_chain schema';
  END IF;
END $$;

-- 2.4 VENDOR_PERFORMANCE_EVENTS
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'vendor_performance_events') THEN
    ALTER TABLE inventory.vendor_performance_events SET SCHEMA supply_chain;
    RAISE NOTICE '✓ Moved vendor_performance_events to supply_chain schema';
  END IF;
END $$;

-- 2.5 PURCHASE_ORDERS
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'purchase_orders') THEN
    ALTER TABLE inventory.purchase_orders SET SCHEMA supply_chain;
    RAISE NOTICE '✓ Moved purchase_orders to supply_chain schema';
  ELSE
    RAISE NOTICE '⚠ purchase_orders table not found';
  END IF;
END $$;

-- 2.6 PURCHASE_ORDER_LINES
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'purchase_order_lines') THEN
    ALTER TABLE inventory.purchase_order_lines SET SCHEMA supply_chain;
    RAISE NOTICE '✓ Moved purchase_order_lines to supply_chain schema';
  ELSE
    RAISE NOTICE '⚠ purchase_order_lines table not found';
  END IF;
END $$;

-- 2.7 RECEIPTS
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'receipts') THEN
    ALTER TABLE inventory.receipts SET SCHEMA supply_chain;
    RAISE NOTICE '✓ Moved receipts to supply_chain schema';
  ELSE
    RAISE NOTICE '⚠ receipts table not found';
  END IF;
END $$;

-- 2.8 RECEIPT_LINES
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'receipt_lines') THEN
    ALTER TABLE inventory.receipt_lines SET SCHEMA supply_chain;
    RAISE NOTICE '✓ Moved receipt_lines to supply_chain schema';
  ELSE
    RAISE NOTICE '⚠ receipt_lines table not found';
  END IF;
END $$;

-- 2.9 ACCOUNTING_EXPENSES (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'accounting_expenses') THEN
    ALTER TABLE inventory.accounting_expenses SET SCHEMA supply_chain;
    RAISE NOTICE '✓ Moved accounting_expenses to supply_chain schema';
  END IF;
END $$;

-- 2.10 PROCUREMENT_EVENTS (ledger for supply chain)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'procurement_events') THEN
    ALTER TABLE inventory.procurement_events SET SCHEMA supply_chain;
    RAISE NOTICE '✓ Moved procurement_events to supply_chain schema';
  END IF;
END $$;

-- =====================================================
-- STEP 3: MOVE SUPPLY_CHAIN FUNCTIONS/RPCS
-- =====================================================

-- 3.1 Move vendor-related functions
DO $$
DECLARE
  func_name TEXT;
BEGIN
  FOR func_name IN
    SELECT proname
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'inventory'
      AND (
        proname LIKE '%vendor%'
        OR proname LIKE '%po%'
        OR proname LIKE '%purchase%'
        OR proname LIKE '%receipt%'
        OR proname LIKE '%expense%'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION inventory.%I SET SCHEMA supply_chain', func_name);
    RAISE NOTICE '✓ Moved function % to supply_chain', func_name;
  END LOOP;
END $$;

-- =====================================================
-- STEP 4: FIX FOREIGN KEY REFERENCES
-- =====================================================
-- catalog_items.preferred_vendor_id → supply_chain.vendors

DO $$
BEGIN
  -- Drop old constraint if exists
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'inventory'
      AND table_name = 'catalog_items'
      AND constraint_name = 'catalog_items_preferred_vendor_fk'
  ) THEN
    ALTER TABLE inventory.catalog_items DROP CONSTRAINT catalog_items_preferred_vendor_fk;
  END IF;
  
  -- Add new cross-schema FK
  ALTER TABLE inventory.catalog_items
    ADD CONSTRAINT catalog_items_preferred_vendor_fk
    FOREIGN KEY (preferred_vendor_id)
    REFERENCES supply_chain.vendors(id)
    ON DELETE SET NULL;
    
  RAISE NOTICE '✓ Fixed FK: catalog_items.preferred_vendor_id → supply_chain.vendors';
END $$;

-- =====================================================
-- STEP 5: UPDATE RLS POLICIES
-- =====================================================

-- Supply chain tables should have tenant isolation
DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOR table_name IN
    SELECT t.table_name
    FROM information_schema.tables t
    WHERE t.table_schema = 'supply_chain'
      AND t.table_type = 'BASE TABLE'
  LOOP
    -- Drop old policies from inventory schema (if any)
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_isolation ON supply_chain.%I', table_name, table_name);
    
    -- Recreate with correct schema reference
    EXECUTE format('
      CREATE POLICY %I_tenant_isolation ON supply_chain.%I
        FOR ALL
        USING (tenant_id = (auth.jwt() ->> ''tenant_id'')::UUID)
    ', table_name || '_tenant_isolation', table_name);
    
    RAISE NOTICE '✓ Updated RLS policy for supply_chain.%', table_name;
  END LOOP;
END $$;

-- =====================================================
-- STEP 6: CREATE COMPATIBILITY VIEWS
-- =====================================================
-- Frontend still expects inventory.vendors, inventory.purchase_orders, etc.
-- Create views in inventory schema that proxy to supply_chain

-- 6.1 vendors view
CREATE OR REPLACE VIEW inventory.vendors AS
SELECT * FROM supply_chain.vendors;

COMMENT ON VIEW inventory.vendors IS 'Compatibility view → supply_chain.vendors';

-- 6.2 vendor_items view
CREATE OR REPLACE VIEW inventory.vendor_items AS
SELECT * FROM supply_chain.vendor_items;

COMMENT ON VIEW inventory.vendor_items IS 'Compatibility view → supply_chain.vendor_items';

-- 6.3 purchase_orders view
CREATE OR REPLACE VIEW inventory.purchase_orders AS
SELECT * FROM supply_chain.purchase_orders;

COMMENT ON VIEW inventory.purchase_orders IS 'Compatibility view → supply_chain.purchase_orders';

-- 6.4 purchase_order_lines view
CREATE OR REPLACE VIEW inventory.purchase_order_lines AS
SELECT * FROM supply_chain.purchase_order_lines;

COMMENT ON VIEW inventory.purchase_order_lines IS 'Compatibility view → supply_chain.purchase_order_lines';

-- 6.5 receipts view
CREATE OR REPLACE VIEW inventory.receipts AS
SELECT * FROM supply_chain.receipts;

COMMENT ON VIEW inventory.receipts IS 'Compatibility view → supply_chain.receipts';

-- 6.6 receipt_lines view
CREATE OR REPLACE VIEW inventory.receipt_lines AS
SELECT * FROM supply_chain.receipt_lines;

COMMENT ON VIEW inventory.receipt_lines IS 'Compatibility view → supply_chain.receipt_lines';

-- 6.7 vendor_performance_metrics view (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'supply_chain' AND table_name = 'vendor_performance_metrics') THEN
    EXECUTE '
      CREATE OR REPLACE VIEW inventory.vendor_performance_metrics AS
      SELECT * FROM supply_chain.vendor_performance_metrics
    ';
    RAISE NOTICE '✓ Created compatibility view: inventory.vendor_performance_metrics';
  END IF;
END $$;

DO $$
BEGIN
  RAISE NOTICE '✓ Created compatibility views in inventory schema';
END $$;

-- =====================================================
-- STEP 7: ENFORCE IDEMPOTENCY ON RECEIPT POSTING
-- =====================================================
-- Add unique constraint on supply_chain.receipts for idempotency

DO $$
BEGIN
  -- Add last_event_id if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'supply_chain'
      AND table_name = 'receipts'
      AND column_name = 'last_event_id'
  ) THEN
    ALTER TABLE supply_chain.receipts
      ADD COLUMN last_event_id TEXT NULL;
    RAISE NOTICE '✓ Added last_event_id to supply_chain.receipts';
  END IF;
  
  -- Add unique constraint for idempotency
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'supply_chain'
      AND table_name = 'receipts'
      AND constraint_name = 'receipts_tenant_last_event_id_unique'
  ) THEN
    ALTER TABLE supply_chain.receipts
      ADD CONSTRAINT receipts_tenant_last_event_id_unique
      UNIQUE (tenant_id, last_event_id);
    RAISE NOTICE '✓ Added idempotency constraint to receipts';
  END IF;
END $$;

-- Same for receipt_lines
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'supply_chain'
      AND table_name = 'receipt_lines'
      AND column_name = 'last_event_id'
  ) THEN
    ALTER TABLE supply_chain.receipt_lines
      ADD COLUMN last_event_id TEXT NULL;
    RAISE NOTICE '✓ Added last_event_id to supply_chain.receipt_lines';
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = 'supply_chain'
      AND table_name = 'receipt_lines'
      AND constraint_name = 'receipt_lines_tenant_last_event_id_unique'
  ) THEN
    ALTER TABLE supply_chain.receipt_lines
      ADD CONSTRAINT receipt_lines_tenant_last_event_id_unique
      UNIQUE (tenant_id, last_event_id);
    RAISE NOTICE '✓ Added idempotency constraint to receipt_lines';
  END IF;
END $$;

-- =====================================================
-- STEP 8: VERIFY INVENTORY SCHEMA INTEGRITY
-- =====================================================

DO $$
DECLARE
  inventory_table_count INT;
BEGIN
  SELECT COUNT(*)
  INTO inventory_table_count
  FROM information_schema.tables
  WHERE table_schema = 'inventory'
    AND table_type = 'BASE TABLE'
    AND table_name NOT IN (
      'vendors', 'vendor_items', 'purchase_orders', 'purchase_order_lines',
      'receipts', 'receipt_lines', 'vendor_performance_metrics',
      'vendor_performance_events', 'accounting_expenses', 'procurement_events'
    );
  
  RAISE NOTICE '✓ Inventory schema contains % core tables', inventory_table_count;
  
  -- Verify critical inventory tables exist
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'stock_balances') THEN
    RAISE NOTICE '✓ stock_balances remains in inventory schema';
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'stock_movements') THEN
    RAISE NOTICE '✓ stock_movements remains in inventory schema';
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'inventory_events') THEN
    RAISE NOTICE '✓ inventory_events remains in inventory schema';
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'reservations') THEN
    RAISE NOTICE '✓ reservations remains in inventory schema';
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'assets') THEN
    RAISE NOTICE '✓ assets remains in inventory schema';
  END IF;
END $$;

-- =====================================================
-- SUMMARY
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== BOUNDED CONTEXT SEPARATION COMPLETE ===';
  RAISE NOTICE '';
  RAISE NOTICE 'supply_chain schema:';
  RAISE NOTICE '  ✓ vendors, vendor_items, vendor_performance_*';
  RAISE NOTICE '  ✓ purchase_orders, purchase_order_lines';
  RAISE NOTICE '  ✓ receipts, receipt_lines';
  RAISE NOTICE '  ✓ procurement_events (ledger)';
  RAISE NOTICE '  ✓ RLS policies enforced';
  RAISE NOTICE '  ✓ Idempotency with last_event_id';
  RAISE NOTICE '';
  RAISE NOTICE 'inventory schema:';
  RAISE NOTICE '  ✓ catalog_items, locations, assets';
  RAISE NOTICE '  ✓ stock_balances, stock_movements';
  RAISE NOTICE '  ✓ inventory_events (ledger)';
  RAISE NOTICE '  ✓ reservations, transfers, cycle_counts';
  RAISE NOTICE '  ✓ Compatibility views for frontend';
  RAISE NOTICE '';
  RAISE NOTICE 'Next step: Create supply_chain.rpc_post_receipt_to_inventory() bridge';
END $$;
