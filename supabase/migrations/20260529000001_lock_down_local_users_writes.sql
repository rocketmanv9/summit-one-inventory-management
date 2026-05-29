-- Lock down public.local_users to webhook-only writes.
--
-- Background:
--   local_users is synced from Summit Core via the `core-events` webhook
--   (src/app/api/webhooks/core-events/route.ts), which uses a tenant service
--   client (service role) and therefore bypasses RLS. A user's `role` in this
--   table OVERRIDES the Core session role during ticket exchange / refresh
--   (enrichRoleFromLocalUsers in src/app/api/auth/{exchange,refresh}/route.ts
--   and src/app/auth/callback/route.ts).
--
-- Problem (introduced in 20260505000001):
--   The "authenticated_insert" policy used WITH CHECK (true), letting ANY
--   authenticated browser client insert arbitrary rows — including
--   (own user_id, own tenant_id, role='admin') for self privilege escalation,
--   or rows targeting other tenants. The browser never legitimately writes this
--   table; all writes come from the service-role webhook.
--
-- First-login timing is safe:
--   enrichRoleFromLocalUsers only READS local_users and tolerates a missing row
--   (it catches the no-row error and falls back to the Core-provided role). Login
--   does NOT require the row to pre-exist, so removing the authenticated INSERT
--   path breaks nothing. The row is created later by the membership webhook.
--
-- This migration removes the authenticated INSERT path entirely. The
-- service_role_full_access policy (FOR ALL) continues to allow the webhook to
-- write, and tenant_read_access continues to allow authenticated users to read
-- their own tenant's rows.

DROP POLICY IF EXISTS "authenticated_insert" ON public.local_users;

-- Intentionally NOT replacing it: authenticated users (browser/RPC layer) must
-- have no INSERT/UPDATE/DELETE access to local_users. Writes are service-role only.

COMMENT ON TABLE public.local_users IS
  'Users synced from Summit Core via the core-events webhook (service role only). '
  'Authenticated clients may READ their own tenant''s rows but may NOT write — '
  'see migration 20260529000001.';
