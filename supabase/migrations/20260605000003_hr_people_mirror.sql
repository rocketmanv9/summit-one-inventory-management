-- Mirror ALL HR people (not just app users) into a local roster.
--
-- Source: summit-one-hr.org_people. Kept fresh two ways:
--   - backfill / safety net: POST /api/hr/sync (pull)
--   - near-real-time: POST /api/webhooks/hr-events (org_people.created/updated/deleted)
--
-- This is a READ-ONLY roster for visibility + position display. Spending limits are NOT
-- stored here: PO caps are enforced only for actual app users (local_users.spending_limit)
-- since only logged-in users create POs; every person still inherits their position's cap.
-- hr_position_id joins to public.positions (tenant_id, hr_position_id) for the local cap.

CREATE TABLE IF NOT EXISTS public.hr_people (
  hr_person_id      UUID NOT NULL,
  tenant_id         UUID NOT NULL,
  hr_position_id    UUID,              -- org_people.position_id -> positions.hr_position_id
  first_name        TEXT,
  last_name         TEXT,
  preferred_name    TEXT,
  work_email        TEXT,
  personal_email    TEXT,
  employee_code     TEXT,
  employment_status TEXT,
  is_active         BOOLEAN DEFAULT true,
  profile_id        UUID,              -- HR's link to a Core profile (often null)
  synced_at         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT hr_people_pk PRIMARY KEY (tenant_id, hr_person_id)
);

CREATE INDEX IF NOT EXISTS idx_hr_people_tenant ON public.hr_people (tenant_id);
CREATE INDEX IF NOT EXISTS idx_hr_people_position ON public.hr_people (tenant_id, hr_position_id);
CREATE INDEX IF NOT EXISTS idx_hr_people_work_email ON public.hr_people (lower(work_email));

ALTER TABLE public.hr_people ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hr_people_service_role_full" ON public.hr_people;
CREATE POLICY "hr_people_service_role_full" ON public.hr_people
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "hr_people_tenant_read" ON public.hr_people;
CREATE POLICY "hr_people_tenant_read" ON public.hr_people
  FOR SELECT TO authenticated
  USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);

GRANT SELECT ON public.hr_people TO authenticated;
GRANT ALL ON public.hr_people TO service_role;

COMMENT ON TABLE public.hr_people IS
  'Read-only roster mirrored from summit-one-hr.org_people (all employees, not just app users). '
  'Refreshed by /api/hr/sync and /api/webhooks/hr-events. No spend limit here — caps live on '
  'positions (per-position) and local_users (per app user).';
