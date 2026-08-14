-- Fix inventory.punchout_orders tenant RLS to read the claim chassis actually
-- mints (item 06, sprint 2026-08-14).
--
-- The original policy was:
--   tenant_id = (current_setting('request.jwt.claims')::json ->> 'tenant_id')::uuid
--
-- ...but chassis session tokens (mintSessionTokens) put the tenant in
-- `app_metadata.tenant_id`, with NO top-level `tenant_id` claim. So for every
-- real logged-in user that expression evaluated to NULL and the policy matched
-- nothing: the browser-side punchout reads on the PO detail panel have silently
-- returned zero rows since they were written. Nobody noticed because the two
-- things they feed both degrade to "just don't render" — the "✓ Amazon
-- confirmed $X" badge, and (item 06) the Amazon purchaser tile.
--
-- Server routes were unaffected throughout: they use the service-role client,
-- which the other policy already allows. This only restores the read path for
-- authenticated browser sessions.
--
-- COALESCE(app_metadata.tenant_id, top-level tenant_id) is exactly the shape
-- every table added to this repo since (external_purchase_links, position_kits,
-- amazon_purchaser_accounts…) already uses, so this brings an old table in line
-- rather than inventing a new convention.

DROP POLICY IF EXISTS punchout_orders_tenant_isolation ON inventory.punchout_orders;

CREATE POLICY punchout_orders_tenant_isolation ON inventory.punchout_orders
  FOR ALL TO authenticated
  USING (
    tenant_id = COALESCE(
      (auth.jwt()->'app_metadata'->>'tenant_id')::uuid,
      (auth.jwt()->>'tenant_id')::uuid
    )
  )
  WITH CHECK (
    tenant_id = COALESCE(
      (auth.jwt()->'app_metadata'->>'tenant_id')::uuid,
      (auth.jwt()->>'tenant_id')::uuid
    )
  );
