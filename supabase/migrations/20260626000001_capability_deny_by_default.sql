-- Flip the DB-level capability check to DENY BY DEFAULT.
--
-- Previously an UNCONFIGURED position passed user_has_capability() (full access).
-- We now deny it, matching the app change in src/lib/access.ts +
-- src/lib/access-server.ts: a position must be explicitly granted a capability.
--
-- Safety valves preserved so no one gets locked out of PO creation by accident:
--   - service-role / no-JWT callers (auto-reorder cron, punchout)  → allow
--   - developers (app_metadata.is_developer = true)                → allow
--   - admins and users with no position                            → allow
--   - unknown users (no local_users row)                           → allow
-- Only an authenticated, non-admin, non-developer user whose assigned position
-- has no capability row (or lacks the key) is denied.

BEGIN;

CREATE OR REPLACE FUNCTION public.user_has_capability(p_capability text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant   uuid;
  v_user     uuid;
  v_dev      boolean;
  v_role     text;
  v_position uuid;
  v_keys     text[];
BEGIN
  v_tenant := COALESCE((auth.jwt()->'app_metadata'->>'tenant_id')::uuid, (auth.jwt()->>'tenant_id')::uuid);
  v_user   := COALESCE((auth.jwt()->'app_metadata'->>'user_id')::uuid, (auth.jwt()->>'sub')::uuid);
  v_dev    := COALESCE((auth.jwt()->'app_metadata'->>'is_developer')::boolean, false);

  -- No authenticated user (service role / background job) → allow.
  IF v_user IS NULL OR v_tenant IS NULL THEN RETURN true; END IF;

  -- Developer safety valve → full.
  IF v_dev THEN RETURN true; END IF;

  SELECT role, position_id INTO v_role, v_position
  FROM public.local_users
  WHERE user_id = v_user AND tenant_id = v_tenant;

  IF v_role IS NULL OR v_role = 'admin' THEN RETURN true; END IF;  -- unknown / admin → full
  IF v_position IS NULL THEN RETURN true; END IF;                  -- no position → full

  SELECT capability_keys INTO v_keys
  FROM public.position_capabilities
  WHERE tenant_id = v_tenant AND position_id = v_position;

  -- capability_keys is NOT NULL, so v_keys IS NULL only when there's no row.
  IF v_keys IS NULL THEN RETURN false; END IF;                     -- unconfigured position → DENY (deny-by-default)
  RETURN p_capability = ANY(v_keys);
END;
$function$;

COMMENT ON FUNCTION public.user_has_capability(text) IS
  'TRUE if the current JWT user effectively has the capability. Deny-by-default: '
  'an unconfigured position is DENIED. Service-role/no-JWT, developers, admins and '
  'no-position users all pass. Used by DB-level guards for write paths that bypass '
  'the app routes (see position_capabilities).';

COMMIT;
