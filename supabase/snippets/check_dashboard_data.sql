-- Check all dashboards and their tenant_ids
SELECT 
    id,
    tenant_id,
    name,
    description,
    is_default,
    created_at
FROM public.dashboards
ORDER BY created_at DESC;

-- Check all dashboard widgets and their tenant_ids
SELECT 
    dw.id,
    dw.tenant_id,
    dw.dashboard_id,
    dw.widget_type,
    d.name as dashboard_name
FROM public.dashboard_widgets dw
LEFT JOIN public.dashboards d ON d.id = dw.dashboard_id
ORDER BY dw.created_at DESC
LIMIT 20;

-- Check what tenant_id we're using in dev
SELECT 'ae837809-1a24-4ab5-ba06-34fd98c05f48'::uuid as dev_tenant_id;
