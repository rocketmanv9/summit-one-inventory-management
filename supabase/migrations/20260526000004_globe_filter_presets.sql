-- ============================================================================
-- Globe Filter Presets
--
-- Persists user-saved filter configurations for the Network/Globe page.
-- Each preset stores the full filter state (filters, layers, statuses).
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory.globe_filter_presets (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     UUID NOT NULL,
  user_id       UUID NOT NULL,

  -- ── Preset data ──────────────────────────────────────────────────────────
  name          TEXT NOT NULL,
  config        JSONB NOT NULL,

  -- ── Timestamps ───────────────────────────────────────────────────────────
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- ── Upsert constraint ───────────────────────────────────────────────────
  UNIQUE (tenant_id, user_id, name)
);

ALTER TABLE inventory.globe_filter_presets ENABLE ROW LEVEL SECURITY;

-- Service role: full access
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'inventory'
      AND tablename = 'globe_filter_presets'
      AND policyname = 'globe_filter_presets_service_role_all'
  ) THEN
    CREATE POLICY globe_filter_presets_service_role_all ON inventory.globe_filter_presets
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Authenticated users: SELECT scoped to tenant
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'inventory'
      AND tablename = 'globe_filter_presets'
      AND policyname = 'globe_filter_presets_tenant_select'
  ) THEN
    CREATE POLICY globe_filter_presets_tenant_select ON inventory.globe_filter_presets
      FOR SELECT TO authenticated
      USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
  END IF;
END $$;

-- Authenticated users: INSERT scoped to tenant
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'inventory'
      AND tablename = 'globe_filter_presets'
      AND policyname = 'globe_filter_presets_tenant_insert'
  ) THEN
    CREATE POLICY globe_filter_presets_tenant_insert ON inventory.globe_filter_presets
      FOR INSERT TO authenticated
      WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
  END IF;
END $$;

-- Authenticated users: UPDATE scoped to tenant
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'inventory'
      AND tablename = 'globe_filter_presets'
      AND policyname = 'globe_filter_presets_tenant_update'
  ) THEN
    CREATE POLICY globe_filter_presets_tenant_update ON inventory.globe_filter_presets
      FOR UPDATE TO authenticated
      USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid)
      WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
  END IF;
END $$;

-- Authenticated users: DELETE scoped to tenant
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'inventory'
      AND tablename = 'globe_filter_presets'
      AND policyname = 'globe_filter_presets_tenant_delete'
  ) THEN
    CREATE POLICY globe_filter_presets_tenant_delete ON inventory.globe_filter_presets
      FOR DELETE TO authenticated
      USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_globe_filter_presets_tenant_id
  ON inventory.globe_filter_presets (tenant_id);

CREATE INDEX IF NOT EXISTS idx_globe_filter_presets_user
  ON inventory.globe_filter_presets (tenant_id, user_id, name);
