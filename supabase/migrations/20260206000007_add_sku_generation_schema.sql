-- SKU generation schema (modular, category-driven)

-- 1) Categories: add SKU configuration and optional nesting
ALTER TABLE inventory.item_categories
  ADD COLUMN IF NOT EXISTS sku_prefix text,
  ADD COLUMN IF NOT EXISTS sku_mode text CHECK (sku_mode IN ('sequential', 'attribute_based', 'manual')),
  ADD COLUMN IF NOT EXISTS parent_category_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'item_categories_parent_category_fkey'
  ) THEN
    ALTER TABLE inventory.item_categories
      ADD CONSTRAINT item_categories_parent_category_fkey
      FOREIGN KEY (parent_category_id) REFERENCES inventory.item_categories(id);
  END IF;
END $$;

-- 2) Items: add base_sku and enforce unique sku
ALTER TABLE inventory.catalog_items
  ADD COLUMN IF NOT EXISTS base_sku text,
  ADD COLUMN IF NOT EXISTS sku text;

CREATE UNIQUE INDEX IF NOT EXISTS catalog_items_sku_unique
  ON inventory.catalog_items (sku);

CREATE INDEX IF NOT EXISTS catalog_items_base_sku_idx
  ON inventory.catalog_items (base_sku);

-- 3) SKU settings: global separator + per-category counters
CREATE TABLE IF NOT EXISTS inventory.sku_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  category_id uuid NOT NULL REFERENCES inventory.item_categories(id),
  separator text NOT NULL DEFAULT '-',
  next_sequence integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category_id)
);

CREATE INDEX IF NOT EXISTS sku_settings_category_id_idx
  ON inventory.sku_settings (category_id);

-- 4) RLS + permissions (match existing inventory patterns)
ALTER TABLE inventory.sku_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'inventory'
      AND tablename = 'sku_settings'
      AND policyname = 'sku_settings_tenant_isolation'
  ) THEN
    CREATE POLICY sku_settings_tenant_isolation
      ON inventory.sku_settings
      FOR ALL
      USING (tenant_id = public.current_tenant_id())
      WITH CHECK (tenant_id = public.current_tenant_id());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'auto_inject_tenant_sku_settings'
  ) THEN
    CREATE TRIGGER auto_inject_tenant_sku_settings
      BEFORE INSERT ON inventory.sku_settings
      FOR EACH ROW
      EXECUTE FUNCTION inventory.auto_inject_tenant_id();
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE inventory.sku_settings TO authenticated;
