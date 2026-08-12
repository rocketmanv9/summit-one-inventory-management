-- Position → capabilities mapping for the "view as position" access model.
--
-- Pairs with public.positions (synced from summit-one-hr). Each row records which
-- app capabilities (nav sections, today) a position is allowed to access. The
-- capability catalog itself is code-defined (src/lib/access.ts) — this table only
-- stores the granted keys per position.
--
-- Semantics: NO row for a position = UNCONFIGURED = full access (so adding this
-- model never silently removes access before an admin configures it). A row with
-- an empty array = explicitly no access. This drives the top-nav "view as"
-- PREVIEW (client-side show/hide); it does NOT enforce server-side permissions.

BEGIN;

CREATE TABLE public.position_capabilities (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  position_id     UUID NOT NULL REFERENCES public.positions(id) ON DELETE CASCADE,
  -- Granted capability keys (e.g. 'inventory','purchasing'); catalog in code.
  capability_keys TEXT[] NOT NULL DEFAULT '{}',
  -- Repo-wide idempotency pattern.
  last_event_id   TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT position_capabilities_pos_uq UNIQUE (tenant_id, position_id),
  CONSTRAINT position_capabilities_evt_uq UNIQUE (tenant_id, last_event_id)
);

CREATE INDEX idx_position_capabilities_tenant ON public.position_capabilities (tenant_id);

ALTER TABLE public.position_capabilities ENABLE ROW LEVEL SECURITY;

-- service_role (write routes) full access
CREATE POLICY "position_capabilities_service_role_full" ON public.position_capabilities
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- authenticated users read their own tenant's grants (writes go via service-role routes).
-- Mirrors the public.positions read policy so the client reads both the same way.
CREATE POLICY "position_capabilities_tenant_read" ON public.position_capabilities
  FOR SELECT TO authenticated
  USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);

GRANT SELECT ON public.position_capabilities TO authenticated;
GRANT ALL ON public.position_capabilities TO service_role;

CREATE TRIGGER update_position_capabilities_updated_at
  BEFORE UPDATE ON public.position_capabilities
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.position_capabilities IS
  'Per-position granted capability keys for the "view as position" access preview. '
  'No row = full access (unconfigured). Catalog of keys is code-defined in src/lib/access.ts. '
  'Authenticated clients may READ their tenant rows; writes are service-role (admin) only.';

COMMIT;
