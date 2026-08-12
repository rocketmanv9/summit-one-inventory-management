-- ============================================================================
-- Entity Images: storage bucket + metadata table for entity photos
-- Supports: catalog_item, asset, tool, vehicle, equipment
-- ============================================================================

-- Create storage bucket for entity images (public read)
INSERT INTO storage.buckets (id, name, public)
VALUES ('entity-images', 'entity-images', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: authenticated users can manage files within their tenant folder
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'entity_images_authenticated_upload'
  ) THEN
    CREATE POLICY entity_images_authenticated_upload ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'entity-images'
        AND (storage.foldername(name))[1] = (current_setting('request.jwt.claims', true)::json->>'tenant_id')
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'entity_images_authenticated_update'
  ) THEN
    CREATE POLICY entity_images_authenticated_update ON storage.objects
      FOR UPDATE TO authenticated
      USING (
        bucket_id = 'entity-images'
        AND (storage.foldername(name))[1] = (current_setting('request.jwt.claims', true)::json->>'tenant_id')
      )
      WITH CHECK (
        bucket_id = 'entity-images'
        AND (storage.foldername(name))[1] = (current_setting('request.jwt.claims', true)::json->>'tenant_id')
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'entity_images_authenticated_delete'
  ) THEN
    CREATE POLICY entity_images_authenticated_delete ON storage.objects
      FOR DELETE TO authenticated
      USING (
        bucket_id = 'entity-images'
        AND (storage.foldername(name))[1] = (current_setting('request.jwt.claims', true)::json->>'tenant_id')
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'entity_images_public_read'
  ) THEN
    CREATE POLICY entity_images_public_read ON storage.objects
      FOR SELECT TO public
      USING (bucket_id = 'entity-images');
  END IF;
END $$;

-- Metadata table
CREATE TABLE IF NOT EXISTS public.entity_images (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   UUID NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('catalog_item', 'asset', 'tool', 'vehicle', 'equipment')),
  entity_id   UUID NOT NULL,
  storage_path TEXT NOT NULL,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_entity_images_entity UNIQUE (tenant_id, entity_type, entity_id)
);

ALTER TABLE public.entity_images ENABLE ROW LEVEL SECURITY;

-- Service role: full access
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'entity_images' AND policyname = 'entity_images_service_role_all'
  ) THEN
    CREATE POLICY entity_images_service_role_all ON public.entity_images
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Authenticated users: tenant-scoped CRUD
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'entity_images' AND policyname = 'entity_images_tenant_select'
  ) THEN
    CREATE POLICY entity_images_tenant_select ON public.entity_images
      FOR SELECT TO authenticated
      USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'entity_images' AND policyname = 'entity_images_tenant_insert'
  ) THEN
    CREATE POLICY entity_images_tenant_insert ON public.entity_images
      FOR INSERT TO authenticated
      WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'entity_images' AND policyname = 'entity_images_tenant_update'
  ) THEN
    CREATE POLICY entity_images_tenant_update ON public.entity_images
      FOR UPDATE TO authenticated
      USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid)
      WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'entity_images' AND policyname = 'entity_images_tenant_delete'
  ) THEN
    CREATE POLICY entity_images_tenant_delete ON public.entity_images
      FOR DELETE TO authenticated
      USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
  END IF;
END $$;

-- Index for tenant-scoped lookups
CREATE INDEX IF NOT EXISTS idx_entity_images_tenant_id ON public.entity_images (tenant_id);

-- Index for batch lookups by entity type
CREATE INDEX IF NOT EXISTS idx_entity_images_tenant_type ON public.entity_images (tenant_id, entity_type);
