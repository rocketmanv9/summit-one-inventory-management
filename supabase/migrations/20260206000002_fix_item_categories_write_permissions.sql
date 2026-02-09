-- Enable write permissions for inventory.item_categories
-- Required for category create/update/delete from the app

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE inventory.item_categories TO authenticated;
