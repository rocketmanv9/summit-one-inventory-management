-- ============================================================================
-- Migration: extend_provider_types_for_procurement
-- Description: Widens the provider_type CHECK constraint on provisioning.providers
--   to support procurement integration types alongside existing provisioning types.
-- ============================================================================

-- Drop the existing CHECK constraint and replace with expanded version
ALTER TABLE provisioning.providers
  DROP CONSTRAINT IF EXISTS providers_provider_type_check;

ALTER TABLE provisioning.providers
  ADD CONSTRAINT providers_provider_type_check
  CHECK (provider_type IN (
    -- Existing provisioning types
    'print_on_demand', 'uniform_vendor',
    'internal_warehouse', 'custom',
    -- New procurement types
    'procurement_marketplace',
    'procurement_distributor',
    'procurement_direct'
  ));
