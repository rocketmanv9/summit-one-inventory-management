-- Seed assignment types for dev tenant
SELECT inventory.seed_default_assignment_types('00000000-0000-0000-0000-000000000001'::UUID);

-- Verify they were created
SELECT 
    type_key,
    display_name,
    icon,
    is_system,
    is_active,
    requires_id,
    sort_order
FROM inventory.assignment_types
WHERE tenant_id = '00000000-0000-0000-0000-000000000001'::UUID
ORDER BY sort_order;
