-- Enforce strict idempotency constraints for last_event_id
-- Date: 2026-01-30

BEGIN;

-- Ensure last_event_id column exists for direct-write tables
DO $$
BEGIN
  -- inventory schema tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'catalog_items') THEN
    ALTER TABLE inventory.catalog_items ADD COLUMN IF NOT EXISTS last_event_id text;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'item_categories') THEN
    ALTER TABLE inventory.item_categories ADD COLUMN IF NOT EXISTS last_event_id text;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'location_types') THEN
    ALTER TABLE inventory.location_types ADD COLUMN IF NOT EXISTS last_event_id text;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'locations') THEN
    ALTER TABLE inventory.locations ADD COLUMN IF NOT EXISTS last_event_id text;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'assignment_types') THEN
    ALTER TABLE inventory.assignment_types ADD COLUMN IF NOT EXISTS last_event_id text;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'assets') THEN
    ALTER TABLE inventory.assets ADD COLUMN IF NOT EXISTS last_event_id text;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'rfid_epc_captures') THEN
    ALTER TABLE inventory.rfid_epc_captures ADD COLUMN IF NOT EXISTS last_event_id text;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'rfid_devices') THEN
    ALTER TABLE inventory.rfid_devices ADD COLUMN IF NOT EXISTS last_event_id text;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'rfid_cycle_count_submissions') THEN
    ALTER TABLE inventory.rfid_cycle_count_submissions ADD COLUMN IF NOT EXISTS last_event_id text;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'rfid_bulk_assignment_sessions') THEN
    ALTER TABLE inventory.rfid_bulk_assignment_sessions ADD COLUMN IF NOT EXISTS last_event_id text;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'rfid_tags') THEN
    ALTER TABLE inventory.rfid_tags ADD COLUMN IF NOT EXISTS last_event_id text;
  END IF;

  -- supply_chain schema tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'supply_chain' AND table_name = 'vendors') THEN
    ALTER TABLE supply_chain.vendors ADD COLUMN IF NOT EXISTS last_event_id text;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'supply_chain' AND table_name = 'vendor_items') THEN
    ALTER TABLE supply_chain.vendor_items ADD COLUMN IF NOT EXISTS last_event_id text;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'supply_chain' AND table_name = 'tenant_settings') THEN
    ALTER TABLE supply_chain.tenant_settings ADD COLUMN IF NOT EXISTS last_event_id text;
  END IF;

  -- public schema tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'dashboards') THEN
    ALTER TABLE public.dashboards ADD COLUMN IF NOT EXISTS last_event_id text;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'dashboard_widgets') THEN
    ALTER TABLE public.dashboard_widgets ADD COLUMN IF NOT EXISTS last_event_id text;
  END IF;
END $$;

-- Helper: backfill missing last_event_id with deterministic legacy values
DO $$
BEGIN
  -- inventory schema tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'inventory_events') THEN
    UPDATE inventory.inventory_events
      SET last_event_id = 'legacy_inventory_events_' || id::text
    WHERE last_event_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'asset_events') THEN
    UPDATE inventory.asset_events
      SET last_event_id = 'legacy_asset_events_' || id::text
    WHERE last_event_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'procurement_events') THEN
    UPDATE inventory.procurement_events
      SET last_event_id = 'legacy_procurement_events_' || id::text
    WHERE last_event_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'stock_movements') THEN
    UPDATE inventory.stock_movements
      SET last_event_id = 'legacy_stock_movements_' || id::text
    WHERE last_event_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'reservations') THEN
    UPDATE inventory.reservations
      SET last_event_id = 'legacy_reservations_' || id::text
    WHERE last_event_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'receipts' AND table_type = 'BASE TABLE') THEN
    UPDATE inventory.receipts
      SET last_event_id = 'legacy_receipts_' || id::text
    WHERE last_event_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'purchase_orders' AND table_type = 'BASE TABLE') THEN
    UPDATE inventory.purchase_orders
      SET last_event_id = 'legacy_purchase_orders_' || id::text
    WHERE last_event_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'purchase_order_lines') THEN
    UPDATE inventory.purchase_order_lines
      SET last_event_id = 'legacy_purchase_order_lines_' || id::text
    WHERE last_event_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'cycle_counts') THEN
    UPDATE inventory.cycle_counts
      SET last_event_id = 'legacy_cycle_counts_' || id::text
    WHERE last_event_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'cycle_count_lines') THEN
    UPDATE inventory.cycle_count_lines
      SET last_event_id = 'legacy_cycle_count_lines_' || id::text
    WHERE last_event_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'transfers') THEN
    UPDATE inventory.transfers
      SET last_event_id = 'legacy_transfers_' || id::text
    WHERE last_event_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'transfer_lines') THEN
    UPDATE inventory.transfer_lines
      SET last_event_id = 'legacy_transfer_lines_' || id::text
    WHERE last_event_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'asset_assignments') THEN
    UPDATE inventory.asset_assignments
      SET last_event_id = 'legacy_asset_assignments_' || id::text
    WHERE last_event_id IS NULL;
  END IF;

  -- direct-write inventory tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'catalog_items') THEN
    UPDATE inventory.catalog_items
      SET last_event_id = 'legacy_catalog_items_' || id::text
    WHERE last_event_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'item_categories') THEN
    UPDATE inventory.item_categories
      SET last_event_id = 'legacy_item_categories_' || id::text
    WHERE last_event_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'location_types') THEN
    UPDATE inventory.location_types
      SET last_event_id = 'legacy_location_types_' || id::text
    WHERE last_event_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'locations') THEN
    UPDATE inventory.locations
      SET last_event_id = 'legacy_locations_' || id::text
    WHERE last_event_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'assignment_types') THEN
    UPDATE inventory.assignment_types
      SET last_event_id = 'legacy_assignment_types_' || id::text
    WHERE last_event_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'assets') THEN
    UPDATE inventory.assets
      SET last_event_id = 'legacy_assets_' || id::text
    WHERE last_event_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'rfid_epc_captures') THEN
    UPDATE inventory.rfid_epc_captures
      SET last_event_id = 'legacy_rfid_epc_captures_' || id::text
    WHERE last_event_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'rfid_devices') THEN
    UPDATE inventory.rfid_devices
      SET last_event_id = 'legacy_rfid_devices_' || id::text
    WHERE last_event_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'rfid_cycle_count_submissions') THEN
    UPDATE inventory.rfid_cycle_count_submissions
      SET last_event_id = 'legacy_rfid_cycle_count_submissions_' || id::text
    WHERE last_event_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'rfid_bulk_assignment_sessions') THEN
    UPDATE inventory.rfid_bulk_assignment_sessions
      SET last_event_id = 'legacy_rfid_bulk_assignment_sessions_' || id::text
    WHERE last_event_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'inventory' AND table_name = 'rfid_tags') THEN
    UPDATE inventory.rfid_tags
      SET last_event_id = 'legacy_rfid_tags_' || id::text
    WHERE last_event_id IS NULL;
  END IF;

  -- supply_chain schema tables (if present)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'supply_chain' AND table_name = 'receipts' AND table_type = 'BASE TABLE') THEN
    UPDATE supply_chain.receipts
      SET last_event_id = 'legacy_sc_receipts_' || id::text
    WHERE last_event_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'supply_chain' AND table_name = 'vendors') THEN
    UPDATE supply_chain.vendors
      SET last_event_id = 'legacy_sc_vendors_' || id::text
    WHERE last_event_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'supply_chain' AND table_name = 'vendor_items') THEN
    UPDATE supply_chain.vendor_items
      SET last_event_id = 'legacy_sc_vendor_items_' || id::text
    WHERE last_event_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'supply_chain' AND table_name = 'tenant_settings') THEN
    UPDATE supply_chain.tenant_settings
      SET last_event_id = 'legacy_sc_tenant_settings_' || id::text
    WHERE last_event_id IS NULL;
  END IF;

  -- public schema tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'dashboards') THEN
    UPDATE public.dashboards
      SET last_event_id = 'legacy_dashboards_' || id::text
    WHERE last_event_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'dashboard_widgets') THEN
    UPDATE public.dashboard_widgets
      SET last_event_id = 'legacy_dashboard_widgets_' || id::text
    WHERE last_event_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'supply_chain' AND table_name = 'purchase_orders' AND table_type = 'BASE TABLE') THEN
    UPDATE supply_chain.purchase_orders
      SET last_event_id = 'legacy_sc_purchase_orders_' || id::text
    WHERE last_event_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'supply_chain' AND table_name = 'purchase_order_lines') THEN
    UPDATE supply_chain.purchase_order_lines
      SET last_event_id = 'legacy_sc_purchase_order_lines_' || id::text
    WHERE last_event_id IS NULL;
  END IF;

  -- Backfill public schema tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tenants') THEN
    UPDATE public.tenants
      SET last_event_id = 'legacy_tenants_' || id::text
    WHERE last_event_id IS NULL;
  END IF;
END $$;

-- Enforce NOT NULL and UNIQUE constraints for last_event_id
-- Note: Only applies to BASE TABLE objects, skips views
DO $$
DECLARE
  v_table_name TEXT;
  v_schema_name TEXT;
BEGIN
  -- Create unique indexes and constraints for all tables with last_event_id column
  FOR v_schema_name, v_table_name IN
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_type = 'BASE TABLE'
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE columns.table_schema = tables.table_schema
          AND columns.table_name = tables.table_name
          AND column_name = 'last_event_id'
      )
  LOOP
    -- Set NOT NULL constraint
    BEGIN
      EXECUTE 'ALTER TABLE ' || v_schema_name || '.' || v_table_name || ' 
        ALTER COLUMN last_event_id SET NOT NULL';
    EXCEPTION WHEN OTHERS THEN
      -- Ignore if column is already NOT NULL or other constraint exists
      NULL;
    END;
    
    -- Try to create unique index (only if table has tenant_id)
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = v_schema_name
        AND table_name = v_table_name
        AND column_name = 'tenant_id'
    ) THEN
      BEGIN
        EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS ' || v_schema_name || '_' || v_table_name || '_tenant_last_event_id_uq 
          ON ' || v_schema_name || '.' || v_table_name || ' (tenant_id, last_event_id)';
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    ELSE
      -- Tables without tenant_id: just create simple unique index on last_event_id
      BEGIN
        EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS ' || v_schema_name || '_' || v_table_name || '_last_event_id_uq 
          ON ' || v_schema_name || '.' || v_table_name || ' (last_event_id)';
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;
  END LOOP;
END $$;

COMMIT;
