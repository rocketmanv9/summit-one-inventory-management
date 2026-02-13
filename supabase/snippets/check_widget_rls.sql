-- Check RLS on widget_registry
SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'widget_registry';

-- Check policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd 
FROM pg_policies 
WHERE schemaname = 'public' AND tablename = 'widget_registry';

-- Try to select as anon role
SET ROLE anon;
SELECT COUNT(*) FROM public.widget_registry;
RESET ROLE;
