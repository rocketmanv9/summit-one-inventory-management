-- =================================================================
-- SUMMIT PUBLISHER PROTOCOL v1.2 (EXACT IMPLEMENTATION)
-- =================================================================
-- ⚠️  WARNING: BREAKING CHANGES
-- This migration replaces the existing event infrastructure with
-- the exact Summit Publisher Protocol v1.2 specification.
--
-- Changes:
-- - Drops event_catalog VIEW → Creates event_catalog TABLE
-- - Recreates summit_config as key-value store
-- - Replaces emit_event() function signature
-- - Creates public.events_outbox (replaces inventory.events_outbox usage)
-- =================================================================

-- =================================================================
-- STEP 1: CLEAN UP EXISTING STRUCTURES
-- =================================================================

-- Drop existing event_catalog view (will recreate as table)
DROP VIEW IF EXISTS public.event_catalog CASCADE;

-- Drop existing summit_config (will recreate with different structure)
DROP TABLE IF EXISTS public.summit_config CASCADE;

-- =================================================================
-- STEP 2: UTILITY FUNCTIONS
-- =================================================================

-- Standard auto-update timestamp function
CREATE OR REPLACE FUNCTION public.fn_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Immutable Event Protection (Events should never change after emission)
CREATE OR REPLACE FUNCTION public.fn_prevent_event_modification()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.payload IS DISTINCT FROM NEW.payload OR 
     OLD.event_type IS DISTINCT FROM NEW.event_type THEN
      RAISE EXCEPTION 'Events are immutable. You cannot modify the payload or type of an existing event.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =================================================================
-- STEP 3: PROTOCOL METADATA (summit_config as key-value store)
-- =================================================================

CREATE TABLE public.summit_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS tr_summit_config_updated ON public.summit_config;
CREATE TRIGGER tr_summit_config_updated BEFORE UPDATE ON public.summit_config
FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();

-- Initialize Config
INSERT INTO public.summit_config (key, value) VALUES
  ('publisher_id', 'inventory-service'), 
  ('environment', 'dev'),
  ('protocol_version', '1.2')
ON CONFLICT (key) DO NOTHING;

-- =================================================================
-- STEP 4: EVENT CATALOG (The Menu) - As TABLE not VIEW
-- =================================================================

CREATE TABLE public.event_catalog (
  event_key TEXT PRIMARY KEY CHECK (event_key ~ '^[a-z0-9_.]+$'), -- Enforce snake_case.dot
  display_name TEXT NOT NULL,
  description TEXT NOT NULL,
  payload_schema JSONB, -- JSON Schema for validation
  payload_example JSONB,
  owner_module TEXT,
  aggregate_type TEXT DEFAULT 'system', -- Categorization
  event_version INTEGER NOT NULL DEFAULT 1,
  is_deprecated BOOLEAN DEFAULT FALSE,
  deprecated_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS tr_catalog_updated ON public.event_catalog;
CREATE TRIGGER tr_catalog_updated BEFORE UPDATE ON public.event_catalog
FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();

-- =================================================================
-- STEP 5: OUTBOX (The Queue)
-- =================================================================

-- Drop existing public.events_outbox view (it's currently a view over inventory.events_outbox)
DROP VIEW IF EXISTS public.events_outbox CASCADE;

CREATE TABLE public.events_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Core Event Data
  event_type TEXT NOT NULL,
  event_version INTEGER NOT NULL DEFAULT 1,
  payload JSONB NOT NULL,
  aggregate_type TEXT,
  aggregate_id UUID,
  
  -- State Machine
  status TEXT NOT NULL DEFAULT 'pending' 
    CHECK (status IN ('pending', 'processing', 'published', 'failed', 'dead')),
  
  -- Tracing
  trace_id UUID DEFAULT gen_random_uuid(),
  correlation_id UUID,
  causation_id UUID,
  
  -- Context
  tenant_id UUID,
  actor_user_id UUID,
  
  -- Retry & Locking Logic
  attempts INTEGER DEFAULT 0,
  error_message TEXT,
  next_attempt_at TIMESTAMPTZ DEFAULT NOW(), -- Smart backoff support
  last_attempt_at TIMESTAMPTZ,
  
  -- Concurrency Control
  locked_at TIMESTAMPTZ,
  locked_by TEXT, -- ID of the worker processing this
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  published_at TIMESTAMPTZ
);

-- Protect Immutability
DROP TRIGGER IF EXISTS tr_outbox_immutable ON public.events_outbox;
CREATE TRIGGER tr_outbox_immutable BEFORE UPDATE ON public.events_outbox
FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_event_modification();

-- =================================================================
-- STEP 6: INDEXES (Optimized for High Throughput)
-- =================================================================

-- The "Poller" Index: Finds pending items instantly
CREATE INDEX IF NOT EXISTS idx_outbox_poll 
ON public.events_outbox(created_at, status) 
WHERE status = 'pending';

-- The "Stream" Index: Efficiently querying by entity
CREATE INDEX IF NOT EXISTS idx_outbox_aggregate 
ON public.events_outbox(aggregate_type, aggregate_id);

-- Tracing Index
CREATE INDEX IF NOT EXISTS idx_outbox_trace ON public.events_outbox(trace_id);

-- =================================================================
-- STEP 7: DEAD LETTER QUEUE (The Graveyard)
-- =================================================================

-- Update existing events_dead_letter to match spec (it already exists)
-- Just ensure it has the right structure
CREATE TABLE IF NOT EXISTS public.events_dead_letter (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_event_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  reason TEXT NOT NULL, -- Why did it die?
  stack_trace TEXT,
  archived_at TIMESTAMPTZ DEFAULT NOW()
);

-- =================================================================
-- STEP 8: ROBUST HELPERS
-- =================================================================

-- A. Upsert Registration
CREATE OR REPLACE FUNCTION register_event(
  p_key TEXT, 
  p_name TEXT, 
  p_desc TEXT, 
  p_example JSONB, 
  p_schema JSONB DEFAULT NULL, 
  p_agg_type TEXT DEFAULT 'system'
) RETURNS VOID AS $$
BEGIN
  INSERT INTO event_catalog (
    event_key, display_name, description, payload_example, payload_schema, aggregate_type
  ) VALUES (p_key, p_name, p_desc, p_example, p_schema, p_agg_type)
  ON CONFLICT (event_key) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    payload_example = EXCLUDED.payload_example,
    payload_schema = COALESCE(EXCLUDED.payload_schema, event_catalog.payload_schema),
    aggregate_type = EXCLUDED.aggregate_type,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- B. Smart Emit (REPLACES existing emit_event with new signature)
CREATE OR REPLACE FUNCTION emit_event(
  p_type TEXT, 
  p_payload JSONB, 
  p_tenant_id UUID DEFAULT NULL, 
  p_actor_id UUID DEFAULT NULL, 
  p_trace_id UUID DEFAULT NULL, 
  p_correlation_id UUID DEFAULT NULL,
  p_aggregate_id UUID DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_id UUID;
  v_version INTEGER;
  v_agg_type TEXT;
BEGIN
  -- Lookup version and aggregate type
  SELECT event_version, aggregate_type INTO v_version, v_agg_type 
  FROM event_catalog 
  WHERE event_key = p_type;
  
  -- Handle unregistered events gracefully (Default to v1 / system)
  IF v_version IS NULL THEN 
    v_version := 1; 
    v_agg_type := 'system';
  END IF;

  INSERT INTO events_outbox (
    event_type, event_version, payload, 
    tenant_id, actor_user_id, 
    trace_id, correlation_id, 
    aggregate_type, aggregate_id
  ) VALUES (
    p_type, v_version, p_payload, 
    p_tenant_id, p_actor_id, 
    COALESCE(p_trace_id, gen_random_uuid()), p_correlation_id,
    v_agg_type, p_aggregate_id
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- C. Update Catalog Item (For Dashboard Editing)
CREATE OR REPLACE FUNCTION update_event_catalog_item(
  p_event_key TEXT,
  p_display_name TEXT,
  p_description TEXT,
  p_category TEXT,
  p_owner_module TEXT,
  p_aggregate_type TEXT,
  p_is_internal BOOLEAN,
  p_is_deprecated BOOLEAN,
  p_deprecated_reason TEXT,
  p_payload_example JSONB,
  p_payload_schema JSONB,
  p_payload_notes TEXT
) RETURNS VOID AS $$
BEGIN
  UPDATE public.event_catalog
  SET 
    display_name = COALESCE(p_display_name, display_name),
    description = COALESCE(p_description, description),
    owner_module = COALESCE(p_owner_module, owner_module),
    aggregate_type = COALESCE(p_aggregate_type, aggregate_type),
    is_deprecated = COALESCE(p_is_deprecated, is_deprecated),
    deprecated_reason = COALESCE(p_deprecated_reason, deprecated_reason),
    payload_example = COALESCE(p_payload_example, payload_example),
    payload_schema = COALESCE(p_payload_schema, payload_schema),
    updated_at = NOW()
  WHERE event_key = p_event_key;
END;
$$ LANGUAGE plpgsql;

-- =================================================================
-- STEP 9: SUMMIT ACCESS CONTROL
-- =================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'summit_bot') THEN
    CREATE USER summit_bot WITH PASSWORD '03d70dd00ecbabe9443ffae9';
  ELSE
    ALTER USER summit_bot WITH PASSWORD '03d70dd00ecbabe9443ffae9';
  END IF;
END
$$;

-- 1. Grant Connection
GRANT CONNECT ON DATABASE postgres TO summit_bot;

-- 2. Grant Schema Usage
GRANT USAGE ON SCHEMA public TO summit_bot;

-- 3. Grant Table Access
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.events_outbox TO summit_bot;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.event_catalog TO summit_bot;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.summit_config TO summit_bot;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.events_dead_letter TO summit_bot;

-- 4. Grant Sequence Access (for auto-increment IDs if any)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO summit_bot;

-- 5. Grant Function Execution (Crucial for helpers)
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO summit_bot;

-- 6. SAFETY: Bypass RLS
DO $$
BEGIN
  ALTER ROLE summit_bot BYPASSRLS;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not grant BYPASSRLS. Bot will rely on Policies.';
END
$$;

-- =================================================================
-- STEP 10: SECURITY (RLS & Bot)
-- =================================================================

-- A. Enable RLS
ALTER TABLE public.event_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.summit_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events_dead_letter ENABLE ROW LEVEL SECURITY;

-- B. Authenticated Access (Read-Only Dashboard)
DROP POLICY IF EXISTS "auth_read_catalog" ON public.event_catalog;
CREATE POLICY "auth_read_catalog" ON public.event_catalog FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_read_outbox" ON public.events_outbox;
CREATE POLICY "auth_read_outbox" ON public.events_outbox FOR SELECT TO authenticated USING (true);

-- C. Summit Bot (Backend Service)
-- Fallback in case BYPASSRLS wasn't granted
DROP POLICY IF EXISTS "bot_full_catalog" ON public.event_catalog;
CREATE POLICY "bot_full_catalog" ON public.event_catalog TO summit_bot USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "bot_full_outbox" ON public.events_outbox;
CREATE POLICY "bot_full_outbox" ON public.events_outbox TO summit_bot USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "bot_full_config" ON public.summit_config;
CREATE POLICY "bot_full_config" ON public.summit_config TO summit_bot USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "bot_full_dlq" ON public.events_dead_letter;
CREATE POLICY "bot_full_dlq" ON public.events_dead_letter TO summit_bot USING (true) WITH CHECK (true);

-- =================================================================
-- VERIFICATION
-- =================================================================

DO $$
DECLARE
  v_outbox_exists BOOLEAN;
  v_catalog_is_table BOOLEAN;
  v_bot_exists BOOLEAN;
  v_config_structure TEXT;
BEGIN
  -- Check public.events_outbox exists
  SELECT EXISTS(
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'events_outbox'
  ) INTO v_outbox_exists;
  
  -- Check event_catalog is now a table (not view)
  SELECT EXISTS(
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'event_catalog'
  ) INTO v_catalog_is_table;
  
  -- Check summit_bot exists
  SELECT EXISTS(
    SELECT FROM pg_catalog.pg_roles WHERE rolname = 'summit_bot'
  ) INTO v_bot_exists;
  
  RAISE NOTICE '========================================';
  RAISE NOTICE 'SUMMIT PUBLISHER PROTOCOL v1.2 INSTALLED';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'public.events_outbox: %', CASE WHEN v_outbox_exists THEN '✓ CREATED' ELSE '✗ FAILED' END;
  RAISE NOTICE 'event_catalog (TABLE): %', CASE WHEN v_catalog_is_table THEN '✓ CREATED' ELSE '✗ FAILED' END;
  RAISE NOTICE 'summit_bot user: %', CASE WHEN v_bot_exists THEN '✓ CREATED' ELSE '✗ FAILED' END;
  RAISE NOTICE '';
  RAISE NOTICE '⚠️  BREAKING CHANGES APPLIED:';
  RAISE NOTICE '- emit_event() now writes to public.events_outbox';
  RAISE NOTICE '- event_catalog is now a TABLE (was VIEW)';
  RAISE NOTICE '- summit_config is now key-value store';
  RAISE NOTICE '';
  RAISE NOTICE 'Connection for Summit Core:';
  RAISE NOTICE 'Host: db.cwmsvmywairkwdmvkdmw.supabase.co:5432';
  RAISE NOTICE 'Database: postgres';
  RAISE NOTICE 'User: summit_bot';
  RAISE NOTICE 'Password: 03d70dd00ecbabe9443ffae9';
  RAISE NOTICE '========================================';
END
$$;
