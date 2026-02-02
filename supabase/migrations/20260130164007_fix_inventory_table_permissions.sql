-- Fix permissions on inventory schema tables
-- Grant SELECT/INSERT/UPDATE/DELETE to authenticated role for inventory operations

-- Stock Balances
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE inventory.stock_balances TO authenticated;

-- Daily Activity
GRANT SELECT, INSERT ON TABLE inventory.daily_item_activity TO authenticated;

-- Catalog Items
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE inventory.catalog_items TO authenticated;

-- Locations
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE inventory.locations TO authenticated;

-- Location Types
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE inventory.location_types TO authenticated;

-- Assets
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE inventory.assets TO authenticated;

-- Asset Assignments
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE inventory.asset_assignments TO authenticated;

-- Reservations
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE inventory.reservations TO authenticated;

-- Transfers
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE inventory.transfers TO authenticated;

-- Transfer Lines
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE inventory.transfer_lines TO authenticated;

-- Cycle Counts
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE inventory.cycle_counts TO authenticated;

-- Cycle Count Lines
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE inventory.cycle_count_lines TO authenticated;

-- Cycle Count Asset Lines
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE inventory.cycle_count_asset_lines TO authenticated;

-- Assignment Types
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE inventory.assignment_types TO authenticated;

-- RFID Tables
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE inventory.rfid_devices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE inventory.rfid_tags TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE inventory.rfid_tag_assignment_history TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE inventory.rfid_bulk_assignment_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE inventory.rfid_cycle_count_submissions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE inventory.rfid_epc_captures TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE inventory.rfid_portal_observations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE inventory.rfid_portal_movement_events TO authenticated;

-- Cycle count snapshots
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE inventory.cycle_count_snapshot_skus TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE inventory.cycle_count_snapshot_assets TO authenticated;

-- Grant sequence permissions for all tables with auto-increment IDs
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA inventory TO authenticated;
