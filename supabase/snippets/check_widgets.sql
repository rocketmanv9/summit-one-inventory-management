-- Query to check widget registry
SELECT widget_key, domain, name, is_enabled 
FROM public.widget_registry 
ORDER BY domain, name;
