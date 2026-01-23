-- ============================================================================
-- PHASE 4: ASSET ASSIGNMENT EVENTS
-- ============================================================================

SELECT public.register_event(
    'asset.assigned',
    1,
    'inventory',
    'Asset assigned to employee/vehicle/job',
    '{"type":"object","required":["asset_id","assignment_id","assigned_to_type","assigned_to_id"],"properties":{"asset_id":{"type":"string","format":"uuid"},"assignment_id":{"type":"string","format":"uuid"},"assigned_to_type":{"type":"string"},"assigned_to_id":{"type":"string"}}}'::jsonb
);

SELECT public.register_event(
    'asset.returned',
    1,
    'inventory',
    'Asset returned from assignment',
    '{"type":"object","required":["asset_id","assignment_id","return_condition"],"properties":{"asset_id":{"type":"string","format":"uuid"},"assignment_id":{"type":"string","format":"uuid"},"return_condition":{"type":"string"},"days_assigned":{"type":"integer"}}}'::jsonb
);

DO $$ BEGIN
    RAISE NOTICE ' Asset assignment events registered';
END $$;

