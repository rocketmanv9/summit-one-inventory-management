-- Drop auth.users foreign keys for item_categories audit columns
-- Core user ids are not guaranteed to exist in auth.users

ALTER TABLE inventory.item_categories
  DROP CONSTRAINT IF EXISTS item_categories_created_by_fkey,
  DROP CONSTRAINT IF EXISTS item_categories_updated_by_fkey;
