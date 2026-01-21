-- Check what triggers are actually set up
SELECT 
    event_object_schema as schema_name,
    event_object_table as table_name,
    trigger_name,
    action_timing,
    event_manipulation as trigger_event
FROM information_schema.triggers
WHERE event_object_schema = 'inventory'
ORDER BY event_object_table, trigger_name;

-- Check trigger functions
SELECT 
    n.nspname as schema_name,
    p.proname as function_name,
    pg_get_function_identity_arguments(p.oid) as arguments
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE p.proname LIKE '%emit%event%'
   OR p.proname LIKE '%trigger%event%'
ORDER BY function_name;
