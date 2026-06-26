-- DB-level capability enforcement for paths that bypass the app's chassis routes.
--
-- Purchase orders are created via a browser→Postgres RPC (rpc_create_purchase_order),
-- so an app-route guard can't see them. We enforce "purchase_orders.manage" with a
-- BEFORE INSERT trigger on supply_chain.purchase_orders instead — it fires no matter
-- which path creates the PO (UI RPC, punchout webhook, etc.).
--
-- Background/service-role jobs (auto-reorder cron, punchout) run without a user JWT;
-- user_has_capability() returns TRUE in that case so they're never blocked. Admins
-- and unconfigured positions also pass (matches the app-side semantics).
--
-- NOTE: only PO creation is enforced here. PO edits/cancel/send are UI-gated in the
-- app; trigger-enforcing UPDATEs is deferred to avoid interfering with receiving.

BEGIN;

-- Effective capability check for the CURRENT JWT user. Mirrors
-- src/lib/access-server.ts resolveUserCapabilities (null/full → true).
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
  v_role     text;
  v_position uuid;
  v_keys     text[];
BEGIN
  v_tenant := COALESCE((auth.jwt()->'app_metadata'->>'tenant_id')::uuid, (auth.jwt()->>'tenant_id')::uuid);
  v_user   := COALESCE((auth.jwt()->'app_metadata'->>'user_id')::uuid, (auth.jwt()->>'sub')::uuid);

  -- No authenticated user (service role / background job) → allow.
  IF v_user IS NULL OR v_tenant IS NULL THEN RETURN true; END IF;

  SELECT role, position_id INTO v_role, v_position
  FROM public.local_users
  WHERE user_id = v_user AND tenant_id = v_tenant;

  IF v_role IS NULL OR v_role = 'admin' THEN RETURN true; END IF;  -- unknown / admin → full
  IF v_position IS NULL THEN RETURN true; END IF;                  -- no position → full

  SELECT capability_keys INTO v_keys
  FROM public.position_capabilities
  WHERE tenant_id = v_tenant AND position_id = v_position;

  IF v_keys IS NULL THEN RETURN true; END IF;                      -- unconfigured → full
  RETURN p_capability = ANY(v_keys);
END;
$function$;

COMMENT ON FUNCTION public.user_has_capability(text) IS
  'TRUE if the current JWT user effectively has the capability (admins, no-position, '
  'unconfigured positions, and service-role/no-JWT callers all pass). Used by DB-level '
  'guards for write paths that bypass the app routes (see position_capabilities).';

-- Enforce PO creation.
CREATE OR REPLACE FUNCTION supply_chain.enforce_po_manage_capability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'supply_chain', 'public'
AS $function$
BEGIN
  IF NOT public.user_has_capability('purchase_orders.manage') THEN
    RAISE EXCEPTION 'Your position does not have permission to create purchase orders'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_po_manage_capability ON supply_chain.purchase_orders;
CREATE TRIGGER enforce_po_manage_capability
  BEFORE INSERT ON supply_chain.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION supply_chain.enforce_po_manage_capability();

COMMIT;
