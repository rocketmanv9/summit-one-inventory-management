-- ============================================================================
-- Fix AI Agent Issues
--
-- 1. Enable pgvector + create inventory.ai_memory table & RPC
-- 2. Drop stale inventory.dashboards / inventory.dashboard_widgets duplicates
-- 3. Add unique indexes for concurrent matview refresh
-- ============================================================================

-- ── Fix 1: pgvector extension + ai_memory table + RPC ──────────────────────

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS inventory.ai_memory (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id               UUID NOT NULL,
  user_id                 UUID,

  memory_type             TEXT NOT NULL
                          CHECK (memory_type IN ('preference', 'fact', 'pattern', 'correction')),
  content                 TEXT NOT NULL,
  embedding               extensions.vector(1536),

  relevance               NUMERIC(3,2) NOT NULL DEFAULT 0.80,
  source_conversation_id  UUID REFERENCES inventory.ai_conversations(id) ON DELETE SET NULL,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_accessed           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE inventory.ai_memory ENABLE ROW LEVEL SECURITY;

-- Service role: full access
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'inventory'
      AND tablename = 'ai_memory'
      AND policyname = 'ai_memory_service_role_all'
  ) THEN
    CREATE POLICY ai_memory_service_role_all ON inventory.ai_memory
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Authenticated users: SELECT scoped to tenant
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'inventory'
      AND tablename = 'ai_memory'
      AND policyname = 'ai_memory_tenant_select'
  ) THEN
    CREATE POLICY ai_memory_tenant_select ON inventory.ai_memory
      FOR SELECT TO authenticated
      USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
  END IF;
END $$;

-- Authenticated users: INSERT scoped to tenant
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'inventory'
      AND tablename = 'ai_memory'
      AND policyname = 'ai_memory_tenant_insert'
  ) THEN
    CREATE POLICY ai_memory_tenant_insert ON inventory.ai_memory
      FOR INSERT TO authenticated
      WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
  END IF;
END $$;

-- Authenticated users: UPDATE scoped to tenant
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'inventory'
      AND tablename = 'ai_memory'
      AND policyname = 'ai_memory_tenant_update'
  ) THEN
    CREATE POLICY ai_memory_tenant_update ON inventory.ai_memory
      FOR UPDATE TO authenticated
      USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid)
      WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ai_memory_tenant_id
  ON inventory.ai_memory (tenant_id);

CREATE INDEX IF NOT EXISTS idx_ai_memory_user
  ON inventory.ai_memory (tenant_id, user_id, memory_type);

CREATE INDEX IF NOT EXISTS idx_ai_memory_last_accessed
  ON inventory.ai_memory (tenant_id, last_accessed DESC);

CREATE INDEX IF NOT EXISTS idx_ai_memory_embedding
  ON inventory.ai_memory
  USING hnsw (embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- RPC: Retrieve relevant memories via vector similarity
CREATE OR REPLACE FUNCTION inventory.rpc_get_relevant_memories(
  query_embedding extensions.vector(1536),
  match_tenant_id UUID,
  match_user_id UUID DEFAULT NULL,
  match_count INT DEFAULT 5,
  min_similarity FLOAT DEFAULT 0.7
)
RETURNS TABLE (
  id UUID,
  memory_type TEXT,
  content TEXT,
  relevance NUMERIC,
  similarity FLOAT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = inventory, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id,
    m.memory_type,
    m.content,
    m.relevance,
    (1 - (m.embedding <=> query_embedding))::FLOAT AS similarity
  FROM inventory.ai_memory m
  WHERE m.tenant_id = match_tenant_id
    AND m.embedding IS NOT NULL
    AND (match_user_id IS NULL OR m.user_id IS NULL OR m.user_id = match_user_id)
    AND (1 - (m.embedding <=> query_embedding)) >= min_similarity
  ORDER BY m.embedding <=> query_embedding ASC
  LIMIT match_count;
END;
$$;

-- ── Fix 2: Drop stale inventory.dashboards / inventory.dashboard_widgets ────
-- The real tables live in public schema. The inventory copies are stale
-- remnants causing PostgREST 300 (Multiple Choices) ambiguity.

DROP TABLE IF EXISTS inventory.dashboard_widgets CASCADE;
DROP TABLE IF EXISTS inventory.dashboards CASCADE;

-- ── Fix 3: Unique indexes for REFRESH MATERIALIZED VIEW CONCURRENTLY ────────
-- Concurrent refresh requires a unique index. Replace the existing non-unique
-- tenant-only indexes with composite unique indexes.

DROP INDEX IF EXISTS inventory.mv_low_stock_summary_tenant_idx;
CREATE UNIQUE INDEX mv_low_stock_summary_uniq
  ON inventory.mv_low_stock_summary (tenant_id, catalog_item_id);

DROP INDEX IF EXISTS inventory.mv_asset_utilization_tenant_idx;
CREATE UNIQUE INDEX mv_asset_utilization_uniq
  ON inventory.mv_asset_utilization (tenant_id, status, asset_type);
