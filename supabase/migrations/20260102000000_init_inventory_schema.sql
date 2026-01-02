-- Migration: Initialize inventory schema
-- This must run before all other inventory migrations

-- =====================================================
-- CREATE SCHEMA
-- =====================================================
CREATE SCHEMA IF NOT EXISTS inventory;

-- =====================================================
-- GRANT PERMISSIONS
-- =====================================================
-- Grant usage on schema to authenticated users
GRANT USAGE ON SCHEMA inventory TO authenticated;
GRANT USAGE ON SCHEMA inventory TO service_role;

-- Grant all privileges to service role (for pollers/background jobs)
GRANT ALL ON ALL TABLES IN SCHEMA inventory TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA inventory TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA inventory TO service_role;

-- Set default privileges for future objects
ALTER DEFAULT PRIVILEGES IN SCHEMA inventory 
    GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA inventory 
    GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA inventory 
    GRANT ALL ON FUNCTIONS TO service_role;

-- =====================================================
-- COMMENTS
-- =====================================================
COMMENT ON SCHEMA inventory IS 'Event-driven inventory management system with dashboards, widgets, and read models';
