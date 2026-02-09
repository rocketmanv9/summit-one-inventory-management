-- Allow authenticated users to read inventory.asset_state (used by assets page)

GRANT SELECT ON TABLE inventory.asset_state TO authenticated;
