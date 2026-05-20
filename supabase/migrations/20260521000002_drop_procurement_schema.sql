-- ============================================================================
-- Migration: drop_procurement_schema
-- Description: Removes the procurement schema and all its tables.
--   The Procurement section duplicated functionality already in
--   Operations > Purchasing and Inventory > Alerts. All tables have 0 rows.
-- ============================================================================

DROP TABLE IF EXISTS procurement.order_items CASCADE;
DROP TABLE IF EXISTS procurement.orders CASCADE;
DROP TABLE IF EXISTS procurement.reorder_rules CASCADE;
DROP TABLE IF EXISTS procurement.audit_log CASCADE;

-- Drop helper functions
DROP FUNCTION IF EXISTS procurement.set_updated_at() CASCADE;
DROP FUNCTION IF EXISTS procurement.next_order_number(uuid) CASCADE;

-- Drop the schema itself
DROP SCHEMA IF EXISTS procurement CASCADE;
