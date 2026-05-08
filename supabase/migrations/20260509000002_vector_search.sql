-- ============================================================================
-- Vector Search: pgvector + Semantic Item Search
--
-- Enables pgvector extension, adds embedding columns to catalog_items,
-- vendors, and locations, creates an embedding queue for async generation,
-- and provides a semantic search RPC for natural-language item lookup.
-- ============================================================================

-- ── Enable pgvector extension ────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- ── Add embedding columns ────────────────────────────────────────────────────
ALTER TABLE inventory.catalog_items
  ADD COLUMN IF NOT EXISTS embedding extensions.vector(1536);

ALTER TABLE supply_chain.vendors
  ADD COLUMN IF NOT EXISTS embedding extensions.vector(1536);

ALTER TABLE inventory.locations
  ADD COLUMN IF NOT EXISTS embedding extensions.vector(1536);

-- ── HNSW indexes for cosine distance ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_catalog_items_embedding_hnsw
  ON inventory.catalog_items
  USING hnsw (embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_vendors_embedding_hnsw
  ON supply_chain.vendors
  USING hnsw (embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_locations_embedding_hnsw
  ON inventory.locations
  USING hnsw (embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ============================================================================
-- Embedding Queue Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory.embedding_queue (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     UUID NOT NULL,

  -- ── Entity reference ─────────────────────────────────────────────────────
  entity_type   TEXT NOT NULL CHECK (entity_type IN ('item', 'vendor', 'location')),
  entity_id     UUID NOT NULL,

  -- ── Processing state ─────────────────────────────────────────────────────
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts      INT NOT NULL DEFAULT 0,
  error_message TEXT,

  -- ── Timestamps ───────────────────────────────────────────────────────────
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS (required for all tenant-scoped tables)
ALTER TABLE inventory.embedding_queue ENABLE ROW LEVEL SECURITY;

-- Service role: full access (used by backend with service_role key)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'inventory'
      AND tablename = 'embedding_queue'
      AND policyname = 'embedding_queue_service_role_all'
  ) THEN
    CREATE POLICY embedding_queue_service_role_all ON inventory.embedding_queue
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Authenticated users: scoped to their tenant (SELECT)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'inventory'
      AND tablename = 'embedding_queue'
      AND policyname = 'embedding_queue_tenant_select'
  ) THEN
    CREATE POLICY embedding_queue_tenant_select ON inventory.embedding_queue
      FOR SELECT TO authenticated
      USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
  END IF;
END $$;

-- Authenticated users: scoped to their tenant (INSERT)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'inventory'
      AND tablename = 'embedding_queue'
      AND policyname = 'embedding_queue_tenant_insert'
  ) THEN
    CREATE POLICY embedding_queue_tenant_insert ON inventory.embedding_queue
      FOR INSERT TO authenticated
      WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
  END IF;
END $$;

-- Index for polling: pick oldest pending jobs first
CREATE INDEX IF NOT EXISTS idx_embedding_queue_status_created
  ON inventory.embedding_queue (status, created_at);

-- Index for tenant-scoped queries
CREATE INDEX IF NOT EXISTS idx_embedding_queue_tenant_id
  ON inventory.embedding_queue (tenant_id);

-- Unique constraint: one queue entry per entity at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_embedding_queue_entity_unique
  ON inventory.embedding_queue (entity_type, entity_id)
  WHERE status IN ('pending', 'processing');

-- ============================================================================
-- Semantic Search RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION inventory.rpc_semantic_search_items(
  query_embedding extensions.vector(1536),
  match_tenant_id UUID,
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  sku TEXT,
  description TEXT,
  category_name TEXT,
  similarity FLOAT8
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = inventory, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ci.id,
    ci.name::TEXT,
    ci.sku::TEXT,
    ci.description::TEXT,
    cat.name::TEXT AS category_name,
    (1 - (ci.embedding <=> query_embedding))::FLOAT8 AS similarity
  FROM inventory.catalog_items ci
  LEFT JOIN inventory.categories cat
    ON cat.id = ci.category_id AND cat.tenant_id = ci.tenant_id
  WHERE ci.tenant_id = match_tenant_id
    AND ci.embedding IS NOT NULL
  ORDER BY ci.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

COMMENT ON FUNCTION inventory.rpc_semantic_search_items IS
  'Semantic vector search over catalog items. Returns items ranked by cosine similarity to the query embedding.';
