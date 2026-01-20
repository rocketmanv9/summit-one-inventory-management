-- PHASE 6: CYCLE COUNT EVENTS
SELECT public.register_event('cycle_count.started', 1, 'inventory', 'Cycle count initiated', '{"type":"object","required":["cycle_count_id","location_id","count_type"],"properties":{"cycle_count_id":{"type":"string","format":"uuid"},"location_id":{"type":"string","format":"uuid"},"count_type":{"type":"string","enum":["full","partial","spot_check"]}}}'::jsonb);
SELECT public.register_event('cycle_count.approved', 1, 'inventory', 'Cycle count approved for posting', '{"type":"object","required":["cycle_count_id","approved_by_user_id"],"properties":{"cycle_count_id":{"type":"string","format":"uuid"},"approved_by_user_id":{"type":"string","format":"uuid"}}}'::jsonb);
SELECT public.register_event('cycle_count.posted', 1, 'inventory', 'Cycle count adjustments posted to ledger', '{"type":"object","required":["cycle_count_id","location_id","adjustments_count","total_variance_qty"],"properties":{"cycle_count_id":{"type":"string","format":"uuid"},"location_id":{"type":"string","format":"uuid"},"adjustments_count":{"type":"integer"},"total_variance_qty":{"type":"number"}}}'::jsonb);
DO $$ BEGIN RAISE NOTICE ' Cycle count events registered'; END $$;

