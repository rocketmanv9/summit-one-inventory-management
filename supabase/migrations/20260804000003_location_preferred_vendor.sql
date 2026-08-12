-- 20260804000003_location_preferred_vendor.sql
-- Preferred vendor is a PER-LOCATION call (Grant, 2026-08-04): each yard has
-- the supplier it actually uses. The PO create page defaults the vendor to
-- the delivery location's preferred one (still changeable), and lets
-- vendors.manage users set it right from the create flow.
ALTER TABLE inventory.locations
  ADD COLUMN IF NOT EXISTS preferred_vendor_id UUID;

COMMENT ON COLUMN inventory.locations.preferred_vendor_id IS
  'supply_chain.vendors.id this yard orders from by default — prefills the PO create page.';
