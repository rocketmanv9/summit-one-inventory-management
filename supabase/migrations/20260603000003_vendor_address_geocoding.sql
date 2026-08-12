-- ============================================================================
-- Migration: Per-location geocoding for vendor addresses + "nearest" lookup
-- Purpose: A vendor can have many addresses (supply_chain.vendor_addresses).
--          Storing lat/lng per address lets us suggest the vendor location
--          closest to a tenant's delivery location when creating a PO.
-- Strategy: All new columns are NULLABLE — zero breaking changes.
-- ============================================================================

-- 1. Coordinates per vendor address (populated via geocoding on save).
ALTER TABLE supply_chain.vendor_addresses
  ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;

ALTER TABLE supply_chain.vendor_addresses
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

COMMENT ON COLUMN supply_chain.vendor_addresses.latitude IS
  'WGS84 latitude. Populated via geocoding on save. Used for nearest-location ranking.';

COMMENT ON COLUMN supply_chain.vendor_addresses.longitude IS
  'WGS84 longitude. Populated via geocoding on save. Used for nearest-location ranking.';

CREATE INDEX IF NOT EXISTS idx_sc_vendor_addresses_geocoded
  ON supply_chain.vendor_addresses (tenant_id)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- 2. Rank a vendor's addresses by great-circle distance (miles) from a tenant
--    location. Tenant is passed explicitly (current_tenant_id() is unreliable
--    under the pooled service client). Addresses without coordinates sort last.
CREATE OR REPLACE FUNCTION supply_chain.rpc_nearest_vendor_addresses(
  p_tenant_id UUID,
  p_vendor_id UUID,
  p_location_id UUID
)
RETURNS TABLE (
  id           UUID,
  vendor_id    UUID,
  address_type TEXT,
  label        TEXT,
  street1      TEXT,
  street2      TEXT,
  city         TEXT,
  state        TEXT,
  zip          TEXT,
  country      TEXT,
  latitude     DOUBLE PRECISION,
  longitude    DOUBLE PRECISION,
  distance_mi  DOUBLE PRECISION
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'supply_chain', 'inventory', 'public'
AS $$
  WITH loc AS (
    SELECT latitude AS lat, longitude AS lng
    FROM inventory.locations
    WHERE id = p_location_id AND tenant_id = p_tenant_id
  )
  SELECT
    a.id, a.vendor_id, a.address_type, a.label, a.street1, a.street2,
    a.city, a.state, a.zip, a.country, a.latitude, a.longitude,
    CASE
      WHEN loc.lat IS NULL OR loc.lng IS NULL OR a.latitude IS NULL OR a.longitude IS NULL
        THEN NULL
      ELSE 3959 * 2 * asin(sqrt(
        power(sin(radians(a.latitude - loc.lat) / 2), 2) +
        cos(radians(loc.lat)) * cos(radians(a.latitude)) *
        power(sin(radians(a.longitude - loc.lng) / 2), 2)
      ))
    END AS distance_mi
  FROM supply_chain.vendor_addresses a
  CROSS JOIN loc
  WHERE a.vendor_id = p_vendor_id
    AND a.tenant_id = p_tenant_id
  ORDER BY distance_mi ASC NULLS LAST, a.address_type;
$$;

GRANT EXECUTE ON FUNCTION supply_chain.rpc_nearest_vendor_addresses(UUID, UUID, UUID)
  TO authenticated, service_role;
