-- Location-specific stock levels and reorder points

CREATE TABLE IF NOT EXISTS inventory.inventory_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  catalog_item_id uuid NOT NULL REFERENCES inventory.catalog_items(id),
  location_id uuid NOT NULL REFERENCES inventory.locations(id),
  current_stock numeric(18,4) NOT NULL DEFAULT 0,
  reorder_point numeric(18,4),
  target_stock numeric(18,4),
  lead_time_days integer,
  safety_stock numeric(18,4),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (catalog_item_id, location_id)
);

CREATE INDEX IF NOT EXISTS inventory_levels_item_idx
  ON inventory.inventory_levels (catalog_item_id);

CREATE INDEX IF NOT EXISTS inventory_levels_location_idx
  ON inventory.inventory_levels (location_id);

ALTER TABLE inventory.inventory_levels ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'inventory'
      AND tablename = 'inventory_levels'
      AND policyname = 'inventory_levels_tenant_isolation'
  ) THEN
    CREATE POLICY inventory_levels_tenant_isolation
      ON inventory.inventory_levels
      FOR ALL
      USING (tenant_id = public.current_tenant_id())
      WITH CHECK (tenant_id = public.current_tenant_id());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'auto_inject_tenant_inventory_levels'
  ) THEN
    CREATE TRIGGER auto_inject_tenant_inventory_levels
      BEFORE INSERT ON inventory.inventory_levels
      FOR EACH ROW
      EXECUTE FUNCTION inventory.auto_inject_tenant_id();
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE inventory.inventory_levels TO authenticated;

CREATE OR REPLACE VIEW inventory.v_item_global_stock AS
SELECT
  tenant_id,
  catalog_item_id,
  SUM(current_stock) AS total_current_stock
FROM inventory.inventory_levels
GROUP BY tenant_id, catalog_item_id;
