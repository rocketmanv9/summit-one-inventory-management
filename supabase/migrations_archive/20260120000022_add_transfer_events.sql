-- ============================================================================
-- PHASE 3: TRANSFER EVENTS
-- ============================================================================

SELECT public.register_event(
    'transfer.created',
    1,
    'inventory',
    'Inventory transfer created in draft status',
    '{"type":"object","required":["transfer_id","from_location_id","to_location_id"],"properties":{"transfer_id":{"type":"string","format":"uuid"},"from_location_id":{"type":"string","format":"uuid"},"to_location_id":{"type":"string","format":"uuid"},"line_count":{"type":"integer"}}}'::jsonb
);

SELECT public.register_event(
    'transfer.completed',
    1,
    'inventory',
    'Inventory transfer completed - goods moved',
    '{"type":"object","required":["transfer_id","from_location_id","to_location_id"],"properties":{"transfer_id":{"type":"string","format":"uuid"},"from_location_id":{"type":"string","format":"uuid"},"to_location_id":{"type":"string","format":"uuid"},"correlation_id":{"type":"string","format":"uuid"}}}'::jsonb
);

SELECT public.register_event(
    'transfer.cancelled',
    1,
    'inventory',
    'Inventory transfer cancelled',
    '{"type":"object","required":["transfer_id"],"properties":{"transfer_id":{"type":"string","format":"uuid"},"reason":{"type":"string"}}}'::jsonb
);

DO $$ BEGIN
    RAISE NOTICE '✅ Transfer events registered';
END $$;

