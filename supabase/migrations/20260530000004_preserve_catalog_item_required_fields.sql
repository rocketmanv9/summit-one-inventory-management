-- Durable guard against the recurring "null value in column sku violates
-- not-null constraint" on catalog_items UPDATE.
--
-- Root cause: the item edit form rebuilds the full payload and sends
-- sku=null (correct for CREATE, where rpc_create_catalog_item generates the SKU,
-- but wrong for EDIT). Client-only fixes keep getting reintroduced whenever that
-- payload block is refactored. This BEFORE UPDATE trigger makes it impossible for
-- ANY code path to null out a NOT NULL column on update: if an update sets one of
-- these to NULL, we keep the existing (OLD) value instead of erroring.
--
-- This only ever preserves data — there is no valid reason to set a NOT NULL
-- column to NULL on update — so it is safe and path-agnostic.

CREATE OR REPLACE FUNCTION inventory.preserve_catalog_item_required_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.sku IS NULL THEN NEW.sku := OLD.sku; END IF;
  IF NEW.name IS NULL THEN NEW.name := OLD.name; END IF;
  IF NEW.tracking_mode IS NULL THEN NEW.tracking_mode := OLD.tracking_mode; END IF;
  IF NEW.uom_term_id IS NULL THEN NEW.uom_term_id := OLD.uom_term_id; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS preserve_catalog_item_required_fields ON inventory.catalog_items;
CREATE TRIGGER preserve_catalog_item_required_fields
  BEFORE UPDATE ON inventory.catalog_items
  FOR EACH ROW EXECUTE FUNCTION inventory.preserve_catalog_item_required_fields();
