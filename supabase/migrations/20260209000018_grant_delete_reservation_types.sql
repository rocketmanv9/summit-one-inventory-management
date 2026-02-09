-- Allow authenticated users to delete tenant-owned reservation types
GRANT DELETE ON TABLE inventory.reservation_types TO authenticated;
