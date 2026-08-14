-- Kill the "Pending Sync" ghosts: root-cause + self-heal.
--
-- Root cause: ensure_local_user_flexible() (20260505000001, rewritten in
-- 20260612000008) inserts local_users stubs with name='Pending Sync' and
-- email=NULL whenever an FK-bearing insert (events_outbox actor, PO created_by,
-- etc.) arrives for a user_id that hasn't been mirrored from Core yet. Nothing
-- ever backfilled those stubs — runHRSync matches local_users to HR people BY
-- EMAIL, so a null-email stub could never heal and they silently accumulated.
--
-- The fix rests on one fact: public.hr_people.profile_id IS the Core user id
-- (verified on stage 2026-08-14: 14/21 local_users match an hr_people row by
-- profile_id). That gives this database a local, runtime-resolvable path from
-- a bare user_id to a real identity — no Core DB access needed.
--
-- This migration:
--   1. lookup_local_user_identity(user_id, tenant_id) — resolve a Core user id
--      to email/name/hr ids via the HR mirror.
--   2. ensure_local_user_flexible() — stubs are now created WITH identity when
--      the HR mirror knows the user; 'Pending Sync' is only the last resort.
--      Also skips the blind INSERT when the row already exists (cheaper on
--      hot tables like events_outbox).
--   3. reconcile_pending_local_users(tenant_id) — self-heal pass for existing
--      stubs, called by runHRSync every sync (button + nightly cron) and run
--      once below for all tenants.
--   4. local_user_references(user_id) — enumerate what actually references a
--      local_users row (drives the honest "Unlinked account" UI + safe Remove).

-- ── 1. Identity lookup via the HR mirror ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lookup_local_user_identity(p_user_id uuid, p_tenant_id uuid)
RETURNS TABLE(email text, full_name text, hr_person_id uuid, hr_position_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    COALESCE(NULLIF(TRIM(hp.work_email), ''), NULLIF(TRIM(hp.personal_email), '')) AS email,
    COALESCE(
      NULLIF(TRIM(CONCAT_WS(' ', hp.first_name, hp.last_name)), ''),
      NULLIF(TRIM(hp.preferred_name), '')
    ) AS full_name,
    hp.hr_person_id,
    hp.hr_position_id
  FROM public.hr_people hp
  WHERE hp.profile_id = p_user_id
    AND hp.tenant_id = p_tenant_id
  ORDER BY hp.is_active DESC, hp.synced_at DESC NULLS LAST
  LIMIT 1;
$$;

-- ── 2. Stub creation now resolves identity first ────────────────────────────
CREATE OR REPLACE FUNCTION public.ensure_local_user_flexible()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rec jsonb := to_jsonb(NEW);
  v_user_id UUID;
  v_tenant_id UUID;
  v_email text;
  v_name text;
  v_hr_person_id uuid;
BEGIN
  v_user_id := COALESCE(
    (v_rec->>'created_by')::uuid,
    (v_rec->>'updated_by')::uuid,
    (v_rec->>'actor_user_id')::uuid,
    (v_rec->>'user_id')::uuid
  );
  v_tenant_id := (v_rec->>'tenant_id')::uuid;

  IF v_user_id IS NULL OR v_tenant_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Fast path: row already mirrored — nothing to do (previous version issued a
  -- blind INSERT..ON CONFLICT on every event insert).
  IF EXISTS (SELECT 1 FROM public.local_users lu WHERE lu.user_id = v_user_id) THEN
    RETURN NEW;
  END IF;

  SELECT i.email, i.full_name, i.hr_person_id
    INTO v_email, v_name, v_hr_person_id
  FROM public.lookup_local_user_identity(v_user_id, v_tenant_id) i;

  INSERT INTO public.local_users (user_id, tenant_id, name, email, hr_person_id, role)
  VALUES (v_user_id, v_tenant_id, COALESCE(v_name, 'Pending Sync'), v_email, v_hr_person_id, 'member')
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

-- ── 3. Reconcile pass: heal existing stubs in place ─────────────────────────
CREATE OR REPLACE FUNCTION public.reconcile_pending_local_users(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_healed int := 0;
  v_remaining int := 0;
BEGIN
  WITH pending AS (
    SELECT lu.user_id
    FROM public.local_users lu
    WHERE lu.tenant_id = p_tenant_id
      AND (lu.email IS NULL OR lu.name IS NULL OR lu.name = 'Pending Sync')
  ),
  resolved AS (
    SELECT p.user_id, i.email, i.full_name, i.hr_person_id, i.hr_position_id
    FROM pending p
    CROSS JOIN LATERAL public.lookup_local_user_identity(p.user_id, p_tenant_id) i
    WHERE i.email IS NOT NULL OR i.full_name IS NOT NULL
  ),
  updated AS (
    UPDATE public.local_users lu
    SET email = COALESCE(lu.email, r.email),
        name = CASE WHEN lu.name IS NULL OR lu.name = 'Pending Sync'
                    THEN COALESCE(r.full_name, lu.name)
                    ELSE lu.name END,
        hr_person_id = COALESCE(lu.hr_person_id, r.hr_person_id),
        position_id = COALESCE(lu.position_id, (
          SELECT pos.id FROM public.positions pos
          WHERE pos.tenant_id = p_tenant_id
            AND pos.hr_position_id = r.hr_position_id
          LIMIT 1
        )),
        synced_at = now()
    FROM resolved r
    WHERE lu.user_id = r.user_id
      AND lu.tenant_id = p_tenant_id
    RETURNING lu.user_id
  )
  SELECT count(*) INTO v_healed FROM updated;

  SELECT count(*) INTO v_remaining
  FROM public.local_users lu
  WHERE lu.tenant_id = p_tenant_id
    AND (lu.email IS NULL OR lu.name IS NULL OR lu.name = 'Pending Sync');

  RETURN jsonb_build_object('healed', v_healed, 'remaining', v_remaining);
END;
$function$;

-- ── 4. What references a local_users row (for honest UI + safe removal) ─────
CREATE OR REPLACE FUNCTION public.local_user_references(p_user_id uuid)
RETURNS TABLE(ref_table text, ref_column text, ref_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_count bigint;
BEGIN
  FOR r IN
    SELECT pc.conrelid::regclass::text AS t, a.attname AS c
    FROM pg_constraint pc
    JOIN unnest(pc.conkey) AS k(attnum) ON true
    JOIN pg_attribute a ON a.attrelid = pc.conrelid AND a.attnum = k.attnum
    WHERE pc.contype = 'f'
      AND pc.confrelid = 'public.local_users'::regclass
  LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE %I = $1', r.t, r.c)
      INTO v_count USING p_user_id;
    IF v_count > 0 THEN
      ref_table := r.t;
      ref_column := r.c;
      ref_count := v_count;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$function$;

-- ── Permissions: server-side only (service_role); never browser-callable ────
REVOKE ALL ON FUNCTION public.lookup_local_user_identity(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_pending_local_users(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.local_user_references(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_local_user_identity(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_pending_local_users(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.local_user_references(uuid) TO service_role;

-- ── One-time heal: reconcile every tenant's existing stubs now ──────────────
SELECT public.reconcile_pending_local_users(t.tenant_id)
FROM (SELECT DISTINCT tenant_id FROM public.local_users) t;
