-- ============================================================================
-- Example service table migration
--
-- Copy this file and customise for your own tables:
--   1. Rename the table (replace "example_items" with your entity name)
--   2. Add your business columns
--   3. Update policy names to match your table
--   4. Number your migration file sequentially (00013_..., 00014_..., etc.)
-- ============================================================================

-- Create the table
CREATE TABLE IF NOT EXISTS public.example_items (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   UUID NOT NULL,

  -- ── Business columns (customise these) ──────────────────────────────────
  name        TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'active',

  -- ── Timestamps ──────────────────────────────────────────────────────────
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS (required for all tenant-scoped tables)
ALTER TABLE public.example_items ENABLE ROW LEVEL SECURITY;

-- Service role: full access (used by backend with service_role key)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'example_items' AND policyname = 'example_items_service_role_all'
  ) THEN
    CREATE POLICY example_items_service_role_all ON public.example_items
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Authenticated users: scoped to their tenant
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'example_items' AND policyname = 'example_items_tenant_select'
  ) THEN
    CREATE POLICY example_items_tenant_select ON public.example_items
      FOR SELECT TO authenticated
      USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'example_items' AND policyname = 'example_items_tenant_insert'
  ) THEN
    CREATE POLICY example_items_tenant_insert ON public.example_items
      FOR INSERT TO authenticated
      WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'example_items' AND policyname = 'example_items_tenant_update'
  ) THEN
    CREATE POLICY example_items_tenant_update ON public.example_items
      FOR UPDATE TO authenticated
      USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid)
      WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
  END IF;
END $$;

-- Index for tenant-scoped queries
CREATE INDEX IF NOT EXISTS idx_example_items_tenant_id ON public.example_items (tenant_id);

-- Optional: composite index for common query patterns
-- CREATE INDEX IF NOT EXISTS idx_example_items_tenant_status ON public.example_items (tenant_id, status);
