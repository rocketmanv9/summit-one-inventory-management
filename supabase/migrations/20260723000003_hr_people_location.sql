-- 20260723000003_hr_people_location.sql
-- Carry HR location on the people mirror (Grant, 2026-07-23).
--
-- HR's org_people.location_id (→ clone_tenant_locations: Auburn / Portland /
-- Reno / Kingston) now mirrors onto public.hr_people so rosters — starting
-- with Settings → Count Qualifications — can filter people by where they work.
-- The sync also stopped filtering to is_active=true (lib/hr.ts), so the mirror
-- holds EVERYONE and deactivations propagate; consumers filter themselves.

ALTER TABLE public.hr_people
    ADD COLUMN IF NOT EXISTS hr_location_id uuid,
    ADD COLUMN IF NOT EXISTS location_name text;

COMMENT ON COLUMN public.hr_people.hr_location_id IS
    'HR org_people.location_id (clone_tenant_locations.id on the HR side). Loose ref — no FK.';
COMMENT ON COLUMN public.hr_people.location_name IS
    'Display name of the HR location at sync time (denormalized for filtering/labels).';

CREATE INDEX IF NOT EXISTS idx_hr_people_location
    ON public.hr_people (tenant_id, hr_location_id)
    WHERE hr_location_id IS NOT NULL;
