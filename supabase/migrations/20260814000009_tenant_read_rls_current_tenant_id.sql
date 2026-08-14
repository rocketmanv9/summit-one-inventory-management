-- Same claim bug, second table — and switch both to the canonical helper
-- (item 06, sprint 2026-08-14). Supersedes 20260814000008's COALESCE form.
--
-- public.local_users.tenant_read_access had the identical defect fixed for
-- punchout_orders one migration ago: it compared tenant_id to a TOP-LEVEL
-- `tenant_id` JWT claim that chassis session tokens never carry (they use
-- app_metadata.tenant_id). Result: for every real browser session the SELECT
-- policy matched zero rows, so client-side name lookups quietly resolved to
-- nothing — the PO approval trail (buyer / approver / decider) fell back to
-- 'Unknown', and item 06's Amazon-purchaser tile could only show an email.
--
-- Note the table's own INSERT policy already used current_tenant_id(); only the
-- read policy was left behind. That helper is the house convention and is
-- strictly more complete than a hand-rolled COALESCE — it checks, in order:
--   1. the app.current_tenant_id GUC (service-role/tenant-scoped clients)
--   2. app_metadata.tenant_id  (chassis session tokens)
--   3. app_metadata.tenantId   (legacy camelCase)
--   4. top-level tenant_id     (the original expectation)
-- so it covers pooled service clients as well as browser sessions.
--
-- Both policies stay tenant-scoped: this restores reads that were intended all
-- along, it does not widen anything across tenants.

-- local_users: SELECT-only tenant read (INSERT policy untouched).
DROP POLICY IF EXISTS tenant_read_access ON public.local_users;

CREATE POLICY tenant_read_access ON public.local_users
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

-- punchout_orders: realign 20260814000008 onto the same helper.
DROP POLICY IF EXISTS punchout_orders_tenant_isolation ON inventory.punchout_orders;

CREATE POLICY punchout_orders_tenant_isolation ON inventory.punchout_orders
  FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
