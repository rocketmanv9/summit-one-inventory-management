-- ============================================================================
-- Enrichment Log Table
--
-- Tracks all AI enrichment attempts (vendor, item, asset) with before/after
-- field comparisons, confidence scores, and approval status.
-- ============================================================================

-- Create the table in the inventory schema
CREATE TABLE IF NOT EXISTS inventory.enrichment_log (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     UUID NOT NULL,

  -- ── Entity reference ─────────────────────────────────────────────────────
  entity_type   TEXT NOT NULL CHECK (entity_type IN ('vendor', 'item', 'asset')),
  entity_id     UUID NOT NULL,

  -- ── Enrichment source ────────────────────────────────────────────────────
  provider      TEXT NOT NULL DEFAULT 'openai',
  source_url    TEXT,

  -- ── Field-level diff: { field: { current, suggested, confidence } } ─────
  fields_suggested JSONB NOT NULL DEFAULT '{}',

  -- ── Set when user accepts (full or partial) ──────────────────────────────
  fields_applied   JSONB,

  -- ── Overall status ───────────────────────────────────────────────────────
  status        TEXT NOT NULL DEFAULT 'suggested'
                CHECK (status IN ('suggested', 'applied', 'rejected', 'partial')),
  confidence    NUMERIC(3,2),

  -- ── Who triggered & approved ─────────────────────────────────────────────
  requested_by  UUID,
  approved_by   UUID,

  -- ── Timestamps ───────────────────────────────────────────────────────────
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS (required for all tenant-scoped tables)
ALTER TABLE inventory.enrichment_log ENABLE ROW LEVEL SECURITY;

-- Service role: full access (used by backend with service_role key)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'inventory'
      AND tablename = 'enrichment_log'
      AND policyname = 'enrichment_log_service_role_all'
  ) THEN
    CREATE POLICY enrichment_log_service_role_all ON inventory.enrichment_log
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Authenticated users: scoped to their tenant (SELECT)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'inventory'
      AND tablename = 'enrichment_log'
      AND policyname = 'enrichment_log_tenant_select'
  ) THEN
    CREATE POLICY enrichment_log_tenant_select ON inventory.enrichment_log
      FOR SELECT TO authenticated
      USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
  END IF;
END $$;

-- Authenticated users: scoped to their tenant (INSERT)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'inventory'
      AND tablename = 'enrichment_log'
      AND policyname = 'enrichment_log_tenant_insert'
  ) THEN
    CREATE POLICY enrichment_log_tenant_insert ON inventory.enrichment_log
      FOR INSERT TO authenticated
      WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
  END IF;
END $$;

-- Authenticated users: scoped to their tenant (UPDATE)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'inventory'
      AND tablename = 'enrichment_log'
      AND policyname = 'enrichment_log_tenant_update'
  ) THEN
    CREATE POLICY enrichment_log_tenant_update ON inventory.enrichment_log
      FOR UPDATE TO authenticated
      USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid)
      WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
  END IF;
END $$;

-- Index for tenant-scoped queries
CREATE INDEX IF NOT EXISTS idx_enrichment_log_tenant_id
  ON inventory.enrichment_log (tenant_id);

-- Composite index for looking up enrichments by entity
CREATE INDEX IF NOT EXISTS idx_enrichment_log_entity
  ON inventory.enrichment_log (tenant_id, entity_type, entity_id);
