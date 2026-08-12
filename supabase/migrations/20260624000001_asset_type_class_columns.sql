-- Add GV-backed type and class references to assets.
-- asset_type_term_id  -> Global Values term (domain depends on asset_kind:
--                        vehicle->vehicle_type, equipment->equipment_type, tool->tool_type)
-- equipment_class_id  -> Global Values equipment_classes catalog id (equipment only)
-- No FKs: GV lives in a separate Supabase project, so these are loose references
-- resolved to labels at render time via the GV SDK.
ALTER TABLE inventory.assets
  ADD COLUMN IF NOT EXISTS asset_type_term_id uuid,
  ADD COLUMN IF NOT EXISTS equipment_class_id uuid;

COMMENT ON COLUMN inventory.assets.asset_type_term_id IS
  'Global Values term id classifying the asset. Domain keyed off asset_kind: vehicle_type / equipment_type / tool_type.';
COMMENT ON COLUMN inventory.assets.equipment_class_id IS
  'Global Values equipment_classes catalog id (equipment assets only).';
