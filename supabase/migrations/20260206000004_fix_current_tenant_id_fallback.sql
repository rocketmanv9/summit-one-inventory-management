-- Ensure current_tenant_id falls back to JWT claims when session context is unset

CREATE OR REPLACE FUNCTION public.current_tenant_id() RETURNS uuid
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  v_tenant_id := NULLIF(current_setting('app.current_tenant_id', true), '')::uuid;

  IF v_tenant_id IS NULL THEN
    v_tenant_id := (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid;
  END IF;

  IF v_tenant_id IS NULL THEN
    v_tenant_id := (auth.jwt() ->> 'tenant_id')::uuid;
  END IF;

  RETURN v_tenant_id;
END;
$$;
