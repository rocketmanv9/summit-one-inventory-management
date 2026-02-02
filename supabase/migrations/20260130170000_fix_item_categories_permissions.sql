-- Fix permissions for item_categories table
-- Items API needs to join with this table for category names

GRANT SELECT ON inventory.item_categories TO authenticated;
