-- @summit/chassis - Base RLS Schema
--
-- This migration sets up the foundational RLS policies and tables
-- for all Summit microservices. Apply this to every service's Supabase project.
--
-- Includes:
-- 1. Setting up app.current_tenant_id for RLS context
-- 2. Creating processed_events table for idempotency (legacy)
-- 3. Creating dead_events table for DLQ
-- 4. Standard RLS helper functions

-- ============================================================================
-- 1. Enable RLS Extension
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 2. Set up Tenant Context via Claim
-- ============================================================================
-- This allows us to use current_setting('app.current_tenant_id')::UUID in RLS policies

-- Function to set the tenant context (call from app)
CREATE OR REPLACE FUNCTION set_claim(claim text, value text)
RETURNS void AS $$
BEGIN
  PERFORM set_config('app.' || claim, value, false);
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 3. Create Processed Events Table (Legacy Idempotency)
-- ============================================================================
-- NOTE: This table is superseded by idempotency_keys (migration 00002).
-- Kept for backward compatibility with services using the legacy idempotencyGuard API.
CREATE TABLE IF NOT EXISTS processed_events (
  event_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  event_type TEXT NOT NULL, -- 'api_write', 'webhook', etc.
  result JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  -- NOTE: No FK to auth.tenants — not all Supabase projects have this table.
  -- Tenant isolation is enforced via RLS policies below.
);

CREATE INDEX IF NOT EXISTS idx_processed_events_tenant_id
  ON processed_events(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_processed_events_created_at
  ON processed_events(created_at DESC);

-- Enable RLS on processed_events
ALTER TABLE processed_events ENABLE ROW LEVEL SECURITY;

-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
-- RLS policies for processed_events
-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
-- ACCESS PATTERN:
--   Service role — full CRUD. Server-side handlers record/query processed events.
--   Authenticated role — SELECT only, tenant-scoped. Users can check if their
--     own request was already processed (read-only, can't fake records).
--   Anon role — no access.
-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

-- Drop old policies for clean upgrade path
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'processed_events' AND policyname = 'Users can only access their tenant''s processed events'
  ) THEN
    DROP POLICY "Users can only access their tenant's processed events" ON processed_events;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'processed_events' AND policyname = 'Service can insert processed events'
  ) THEN
    DROP POLICY "Service can insert processed events" ON processed_events;
  END IF;
END $$;

-- Service role: full access
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'processed_events' AND policyname = 'service_role full access'
  ) THEN
    CREATE POLICY "service_role full access"
      ON processed_events
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- Authenticated: read own tenant's records only
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'processed_events' AND policyname = 'authenticated read own tenant'
  ) THEN
    CREATE POLICY "authenticated read own tenant"
      ON processed_events
      FOR SELECT
      TO authenticated
      USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
  END IF;
END $$;

-- ============================================================================
-- 4. Create Dead Events Table (Failed Webhooks)
-- ============================================================================
CREATE TABLE IF NOT EXISTS dead_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  error_message TEXT,
  retry_count INT NOT NULL DEFAULT 0,
  max_retries INT NOT NULL DEFAULT 5,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  failed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dead_events_tenant_id
  ON dead_events(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dead_events_event_id
  ON dead_events(event_id);

-- Enable RLS on dead_events
ALTER TABLE dead_events ENABLE ROW LEVEL SECURITY;

-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
-- RLS policies for dead_events
-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
-- ACCESS PATTERN:
--   Service role — full CRUD. Pollers insert failed events here.
--   Authenticated role — SELECT only, tenant-scoped, admin only.
--     Lets tenant admins inspect their own DLQ for debugging.
--   Anon role — no access.
-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

-- Drop old policy for clean upgrade
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'dead_events' AND policyname = 'Users can view their tenant''s dead events'
  ) THEN
    DROP POLICY "Users can view their tenant's dead events" ON dead_events;
  END IF;
END $$;

-- Service role: full access
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'dead_events' AND policyname = 'service_role full access'
  ) THEN
    CREATE POLICY "service_role full access"
      ON dead_events
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- Authenticated admin: read own tenant only
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'dead_events' AND policyname = 'authenticated admin read own tenant'
  ) THEN
    CREATE POLICY "authenticated admin read own tenant"
      ON dead_events
      FOR SELECT
      TO authenticated
      USING (
        tenant_id = current_setting('app.current_tenant_id')::UUID
        AND current_setting('app.role', true)::text = 'admin'
      );
  END IF;
END $$;

-- ============================================================================
-- 5. Create Audit Log Table (Standard for all services)
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  action TEXT NOT NULL, -- 'create', 'update', 'delete'
  entity_type TEXT NOT NULL, -- 'user', 'order', 'inventory', etc.
  entity_id UUID,
  changes JSONB, -- Before/after values
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_user
  ON audit_logs(tenant_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
  ON audit_logs(entity_type, entity_id);

-- Enable RLS on audit_logs
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
-- RLS policies for audit_logs
-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
-- ACCESS PATTERN:
--   Service role — full CRUD. Server-side code writes audit entries.
--   Authenticated role — SELECT only, tenant-scoped.
--   Anon role — no access.
-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

-- Drop old policies for clean upgrade
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'audit_logs' AND policyname = 'Users can view their tenant''s audit logs'
  ) THEN
    DROP POLICY "Users can view their tenant's audit logs" ON audit_logs;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'audit_logs' AND policyname = 'Service can insert audit logs'
  ) THEN
    DROP POLICY "Service can insert audit logs" ON audit_logs;
  END IF;
END $$;

-- Service role: full access
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'audit_logs' AND policyname = 'service_role full access'
  ) THEN
    CREATE POLICY "service_role full access"
      ON audit_logs
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- Authenticated: read own tenant only
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'audit_logs' AND policyname = 'authenticated read own tenant'
  ) THEN
    CREATE POLICY "authenticated read own tenant"
      ON audit_logs
      FOR SELECT
      TO authenticated
      USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
  END IF;
END $$;

-- ============================================================================
-- 6. Webhook Subscriptions Table (for event distribution)
-- ============================================================================
CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  event_type TEXT NOT NULL, -- Can be wildcard: 'inventory.*'
  url TEXT NOT NULL,
  secret TEXT NOT NULL, -- For HMAC signing
  active BOOLEAN NOT NULL DEFAULT true,
  max_retries INT NOT NULL DEFAULT 5,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT unique_subscription UNIQUE(tenant_id, event_type, url)
);

CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_tenant
  ON webhook_subscriptions(tenant_id, active);

CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_event_type
  ON webhook_subscriptions(event_type);

-- Enable RLS on webhook_subscriptions
ALTER TABLE webhook_subscriptions ENABLE ROW LEVEL SECURITY;

-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
-- RLS policies for webhook_subscriptions
-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
-- ACCESS PATTERN:
--   Service role — full CRUD (reads subscriptions during dispatch).
--   Authenticated role — full CRUD, tenant-scoped.
--     Tenant admins manage their own webhook subscriptions.
--   Anon role — no access.
-- ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

-- Drop old policy for clean upgrade
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'webhook_subscriptions' AND policyname = 'Users can manage their tenant''s webhook subscriptions'
  ) THEN
    DROP POLICY "Users can manage their tenant's webhook subscriptions" ON webhook_subscriptions;
  END IF;
END $$;

-- Service role: full access
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'webhook_subscriptions' AND policyname = 'service_role full access'
  ) THEN
    CREATE POLICY "service_role full access"
      ON webhook_subscriptions
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- Authenticated: full CRUD, own tenant only
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'webhook_subscriptions' AND policyname = 'authenticated manage own tenant'
  ) THEN
    CREATE POLICY "authenticated manage own tenant"
      ON webhook_subscriptions
      FOR ALL
      TO authenticated
      USING (tenant_id = current_setting('app.current_tenant_id')::UUID)
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::UUID);
  END IF;
END $$;

-- ============================================================================
-- 7. Cleanup Function (for processed_events retention)
-- ============================================================================
CREATE OR REPLACE FUNCTION cleanup_old_processed_events(days_to_keep INT DEFAULT 30)
RETURNS TABLE(deleted_count INT) AS $$
DECLARE
  v_deleted_count INT;
BEGIN
  DELETE FROM processed_events
  WHERE created_at < NOW() - INTERVAL '1 day' * days_to_keep;

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  RETURN QUERY SELECT v_deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 8. Template RLS Policy for Service Tables
-- ============================================================================
-- Copy these policies for each table you create. Always scope to service_role
-- for server-side access and authenticated + tenant for client-side access.
--
-- -- Service role: full access
-- CREATE POLICY "service_role full access"
--   ON your_table FOR ALL TO service_role
--   USING (true) WITH CHECK (true);
--
-- -- Authenticated: CRUD own tenant
-- CREATE POLICY "authenticated manage own tenant"
--   ON your_table FOR ALL TO authenticated
--   USING (tenant_id = current_setting('app.current_tenant_id')::UUID)
--   WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::UUID);
--
-- ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 9. Verification Queries (run after deployment)
-- ============================================================================
-- Check that RLS is enabled:
-- SELECT tablename, rowsecurity FROM pg_tables WHERE tablename IN ('processed_events', 'dead_events', 'audit_logs', 'webhook_subscriptions');
--
-- Check policies:
-- SELECT schemaname, tablename, policyname, qual FROM pg_policies WHERE tablename IN ('processed_events', 'dead_events', 'audit_logs', 'webhook_subscriptions');
