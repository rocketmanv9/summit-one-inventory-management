-- ============================================================================
-- AI Usage Log Table
--
-- Tracks token usage, cost, latency, and tool invocations for all AI chat
-- requests. Used for observability dashboards, cost monitoring, and audit.
-- ============================================================================

-- Create the table in the inventory schema
CREATE TABLE IF NOT EXISTS inventory.ai_usage_log (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id           UUID NOT NULL,
  user_id             UUID NOT NULL,
  conversation_id     UUID REFERENCES inventory.ai_conversations(id) ON DELETE SET NULL,

  -- ── Model & token usage ──────────────────────────────────────────────────
  model               TEXT NOT NULL DEFAULT 'gpt-4.1',
  prompt_tokens       INT NOT NULL DEFAULT 0,
  completion_tokens   INT NOT NULL DEFAULT 0,
  total_tokens        INT NOT NULL DEFAULT 0,
  estimated_cost_usd  NUMERIC(10,6) DEFAULT 0,
  latency_ms          INT DEFAULT 0,

  -- ── Tool & intent tracking ───────────────────────────────────────────────
  tools_called        JSONB DEFAULT '[]',
  intent_type         TEXT,
  surface             TEXT DEFAULT 'corner',

  -- ── Timestamps ───────────────────────────────────────────────────────────
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS (required for all tenant-scoped tables)
ALTER TABLE inventory.ai_usage_log ENABLE ROW LEVEL SECURITY;

-- Service role: full access (used by backend with service_role key)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'inventory'
      AND tablename = 'ai_usage_log'
      AND policyname = 'ai_usage_log_service_role_all'
  ) THEN
    CREATE POLICY ai_usage_log_service_role_all ON inventory.ai_usage_log
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Authenticated users: scoped to their tenant (SELECT)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'inventory'
      AND tablename = 'ai_usage_log'
      AND policyname = 'ai_usage_log_tenant_select'
  ) THEN
    CREATE POLICY ai_usage_log_tenant_select ON inventory.ai_usage_log
      FOR SELECT TO authenticated
      USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
  END IF;
END $$;

-- Authenticated users: scoped to their tenant (INSERT)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'inventory'
      AND tablename = 'ai_usage_log'
      AND policyname = 'ai_usage_log_tenant_insert'
  ) THEN
    CREATE POLICY ai_usage_log_tenant_insert ON inventory.ai_usage_log
      FOR INSERT TO authenticated
      WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
  END IF;
END $$;

-- Index for tenant-scoped queries
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_tenant_id
  ON inventory.ai_usage_log (tenant_id);

-- Composite index for time-series queries (cost dashboards, usage charts)
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_tenant_created
  ON inventory.ai_usage_log (tenant_id, created_at DESC);
