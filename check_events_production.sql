-- Check if events were inserted
SELECT 
    COUNT(*) FILTER (WHERE event_name LIKE 'supply_chain.%') as supply_chain_events,
    COUNT(*) FILTER (WHERE event_name LIKE 'inventory.%') as inventory_events,
    COUNT(*) as total_events
FROM public.event_definitions;

-- Show first 10 events
SELECT event_name, producer, status
FROM public.event_definitions
ORDER BY event_name
LIMIT 10;

-- Check event_catalog view
SELECT COUNT(*) as catalog_count
FROM public.event_catalog;
