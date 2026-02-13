-- Query all events in catalog
SELECT 
    event_name,
    version,
    producer,
    status,
    LEFT(description, 50) as description_preview
FROM public.event_definitions
ORDER BY event_name;

-- Get total count
SELECT COUNT(*) as total_events FROM public.event_definitions;

-- Group by event category
SELECT 
    SPLIT_PART(event_name, '.', 1) as category,
    COUNT(*) as event_count
FROM public.event_definitions
GROUP BY SPLIT_PART(event_name, '.', 1)
ORDER BY event_count DESC;
