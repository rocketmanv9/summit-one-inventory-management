-- Grant permissions on inventory.events_outbox to authenticated role
-- This allows debug endpoints to query event data for admin users

GRANT SELECT ON TABLE inventory.events_outbox TO authenticated;
GRANT SELECT ON TABLE inventory.events_outbox TO anon;

-- Also ensure service_role has full access (should already exist but being explicit)
GRANT ALL ON TABLE inventory.events_outbox TO service_role;

-- Add RLS policy to restrict access to tenant's events only
ALTER TABLE inventory.events_outbox ENABLE ROW LEVEL SECURITY;

-- Drop existing policy if it exists
DROP POLICY IF EXISTS "events_outbox_tenant_isolation" ON inventory.events_outbox;

-- Create new policy for tenant isolation
CREATE POLICY "events_outbox_tenant_isolation" ON inventory.events_outbox
  FOR SELECT
  USING (
    tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
  );
