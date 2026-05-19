-- ============================================================================
-- Migration: Add geocoding columns for operations globe visualization
-- Purpose: Enable lat/lng storage for locations and vendors on the 3D globe
-- Strategy: All new columns are NULLABLE — zero breaking changes
-- ============================================================================

-- 1. inventory.locations — latitude/longitude for yard/warehouse pins
ALTER TABLE inventory.locations
  ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;

ALTER TABLE inventory.locations
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

COMMENT ON COLUMN inventory.locations.latitude IS
  'WGS84 latitude for globe visualization. Populated via geocoding.';

COMMENT ON COLUMN inventory.locations.longitude IS
  'WGS84 longitude for globe visualization. Populated via geocoding.';

CREATE INDEX IF NOT EXISTS idx_locations_tenant_geocoded
  ON inventory.locations (tenant_id)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- 2. supply_chain.vendors — latitude/longitude + address fields for vendor pins
ALTER TABLE supply_chain.vendors
  ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;

ALTER TABLE supply_chain.vendors
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

ALTER TABLE supply_chain.vendors
  ADD COLUMN IF NOT EXISTS address_line_1 TEXT;

ALTER TABLE supply_chain.vendors
  ADD COLUMN IF NOT EXISTS city TEXT;

ALTER TABLE supply_chain.vendors
  ADD COLUMN IF NOT EXISTS state TEXT;

ALTER TABLE supply_chain.vendors
  ADD COLUMN IF NOT EXISTS postal_code TEXT;

ALTER TABLE supply_chain.vendors
  ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'US';

COMMENT ON COLUMN supply_chain.vendors.latitude IS
  'WGS84 latitude for globe visualization. Populated via geocoding.';

COMMENT ON COLUMN supply_chain.vendors.longitude IS
  'WGS84 longitude for globe visualization. Populated via geocoding.';

COMMENT ON COLUMN supply_chain.vendors.address_line_1 IS
  'Street address for vendor location and geocoding.';

COMMENT ON COLUMN supply_chain.vendors.city IS
  'City for vendor location and geocoding.';

COMMENT ON COLUMN supply_chain.vendors.state IS
  'State/province for vendor location and geocoding.';

COMMENT ON COLUMN supply_chain.vendors.postal_code IS
  'Postal/ZIP code for vendor location and geocoding.';

COMMENT ON COLUMN supply_chain.vendors.country IS
  'ISO country code for vendor location. Defaults to US.';

CREATE INDEX IF NOT EXISTS idx_vendors_tenant_geocoded
  ON supply_chain.vendors (tenant_id)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
