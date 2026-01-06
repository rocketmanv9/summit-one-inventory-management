-- Check widget registry data
SELECT 
    widget_key, 
    domain, 
    name, 
    is_enabled,
    created_at
FROM public.widget_registry 
ORDER BY domain, name
LIMIT 50;
