-- Follow-up to 20260814000001: the reconcile pass only resolved stubs by
-- hr_people.profile_id (the Core user id). Stage promptly surfaced a second
-- shape of half-linked row: email present but name NULL (e.g. a Core
-- membership webhook that carried no name — dthomas@acmoate.com = HR's
-- "Apple Tester", whose HR row has no profile_id). Add an email-based second
-- pass so those rows heal too: fill name / hr_person_id / position_id from the
-- HR mirror matched on work_email/personal_email.

CREATE OR REPLACE FUNCTION public.reconcile_pending_local_users(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_healed int := 0;
  v_healed_email int := 0;
  v_remaining int := 0;
BEGIN
  -- Pass 1: resolve bare user_ids via hr_people.profile_id (Core user id).
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

  -- Pass 2: rows that carry an email but no (real) name — match the HR mirror
  -- by email and backfill name / hr link.
  WITH pending AS (
    SELECT lu.user_id, lower(trim(lu.email)) AS email_key
    FROM public.local_users lu
    WHERE lu.tenant_id = p_tenant_id
      AND lu.email IS NOT NULL
      AND (lu.name IS NULL OR lu.name = 'Pending Sync')
  ),
  matched AS (
    SELECT DISTINCT ON (p.user_id)
      p.user_id,
      COALESCE(
        NULLIF(TRIM(CONCAT_WS(' ', hp.first_name, hp.last_name)), ''),
        NULLIF(TRIM(hp.preferred_name), '')
      ) AS full_name,
      hp.hr_person_id,
      hp.hr_position_id
    FROM pending p
    JOIN public.hr_people hp
      ON hp.tenant_id = p_tenant_id
     AND (lower(trim(hp.work_email)) = p.email_key OR lower(trim(hp.personal_email)) = p.email_key)
    ORDER BY p.user_id, hp.is_active DESC, hp.synced_at DESC NULLS LAST
  ),
  updated AS (
    UPDATE public.local_users lu
    SET name = COALESCE(m.full_name, lu.name),
        hr_person_id = COALESCE(lu.hr_person_id, m.hr_person_id),
        position_id = COALESCE(lu.position_id, (
          SELECT pos.id FROM public.positions pos
          WHERE pos.tenant_id = p_tenant_id
            AND pos.hr_position_id = m.hr_position_id
          LIMIT 1
        )),
        synced_at = now()
    FROM matched m
    WHERE lu.user_id = m.user_id
      AND lu.tenant_id = p_tenant_id
      AND m.full_name IS NOT NULL
    RETURNING lu.user_id
  )
  SELECT count(*) INTO v_healed_email FROM updated;

  SELECT count(*) INTO v_remaining
  FROM public.local_users lu
  WHERE lu.tenant_id = p_tenant_id
    AND (lu.email IS NULL OR lu.name IS NULL OR lu.name = 'Pending Sync');

  RETURN jsonb_build_object('healed', v_healed + v_healed_email, 'remaining', v_remaining);
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_pending_local_users(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_pending_local_users(uuid) TO service_role;

-- Re-run the heal for all tenants with the email fallback in place.
SELECT public.reconcile_pending_local_users(t.tenant_id)
FROM (SELECT DISTINCT tenant_id FROM public.local_users) t;
