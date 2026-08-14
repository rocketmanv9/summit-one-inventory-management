-- Onboarding allocation type (kits/amazon/fleet sprint, item 04).
--
-- inventory.reservations.allocation_type is validated by
-- inventory.validate_reservation_allocation_type() against
-- inventory.reservation_types — an unknown key raises check_violation, so the
-- kit engine's `allocation_type = 'onboarding'` needs a row here or every
-- new-hire reservation fails at insert time.
--
-- Global (tenant_id NULL) + is_system like the other five built-ins
-- (job / project / customer_order / internal_order / other): "gear held for a
-- new hire" is a Summit-wide concept, not a tenant customization.

INSERT INTO inventory.reservation_types (tenant_id, type_key, display_name, is_system, is_active, sort_order, description)
SELECT NULL, 'onboarding', 'New Hire Onboarding', true, true, 60,
       'Stock held on the shelf for an incoming employee''s position kit.'
WHERE NOT EXISTS (
  SELECT 1 FROM inventory.reservation_types
  WHERE type_key = 'onboarding' AND tenant_id IS NULL
);
