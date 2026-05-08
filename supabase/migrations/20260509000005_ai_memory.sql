-- ============================================================================
-- AI Memory Table
--
-- Stores persistent memories for Isabelle: user preferences, corrections,
-- facts, and patterns. Supports vector similarity search for relevant
-- memory retrieval at conversation time.
-- Depends on pgvector extension (enabled in 20260509000002_vector_search.sql).
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory.ai_memory (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id               UUID NOT NULL,
  user_id                 UUID,  -- NULL = tenant-wide memory

  -- ── Memory content ─────────────────────────────────────────────────────────
  memory_type             TEXT NOT NULL
                          CHECK (memory_type IN ('preference', 'fact', 'pattern', 'correction')),
  content                 TEXT NOT NULL,
  embedding               extensions.vector(1536),

  -- ── Relevance & provenance ─────────────────────────────────────────────────
  relevance               NUMERIC(3,2) NOT NULL DEFAULT 0.80,
  source_conversation_id  UUID REFERENCES inventory.ai_conversations(id) ON DELETE SET NULL,

  -- ── Timestamps ─────────────────────────────────────────────────────────────
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

-- HNSW index for vector similarity search
CREATE INDEX IF NOT EXISTS idx_ai_memory_embedding
  ON inventory.ai_memory
  USING hnsw (embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ── RPC: Retrieve relevant memories via vector similarity ────────────────────

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
