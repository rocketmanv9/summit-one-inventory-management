-- =====================================================================
-- Migration: Ensure tenant row exists for tenant_settings
-- Date: 2026-02-09
-- Description: Bootstrap public.tenants when missing and expand tenantId
--              support in auto_inject_tenant_id.
-- =====================================================================

-- Helper to ensure tenant exists (for dev/bootstrap environments)
CREATE OR REPLACE FUNCTION public.ensure_tenant_exists(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_name TEXT;
BEGIN
  IF p_tenant_id IS NULL THEN
    RETURN;
  END IF;

  SELECT name INTO v_name
  FROM public.tenants
  WHERE id = p_tenant_id;

  IF NOT FOUND THEN
    v_name := COALESCE(
      auth.jwt() -> 'app_metadata' ->> 'tenant_name',
      auth.jwt() -> 'app_metadata' ->> 'tenantName',
      auth.jwt() -> 'app_metadata' ->> 'name',
      'Tenant ' || p_tenant_id::text
    );

    INSERT INTO public.tenants (
      id,
      name,
      last_event_id,
      metadata
    ) VALUES (
      p_tenant_id,
      v_name,
      'bootstrap_tenant_' || p_tenant_id::text,
      jsonb_build_object('bootstrap', true)
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;
END;
$$;

-- Update get_or_create_tenant_settings to bootstrap tenant if missing
CREATE OR REPLACE FUNCTION supply_chain.get_or_create_tenant_settings(p_tenant_id UUID)
RETURNS supply_chain.tenant_settings
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_settings supply_chain.tenant_settings;
BEGIN
  SELECT * INTO v_settings
  FROM supply_chain.tenant_settings
  WHERE tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    PERFORM public.ensure_tenant_exists(p_tenant_id);

    INSERT INTO supply_chain.tenant_settings (
      tenant_id,
      po_number_format,
      po_number_prefix,
      po_number_current_seq,
      auto_approve_enabled,
      auto_approve_limit,
      vendor_code_strategy,
      vendor_code_required,
      vendor_code_case,
      vendor_code_min_length,
      vendor_code_max_length,
      vendor_code_prefix,
      vendor_code_suffix,
      vendor_code_allowed_chars,
      vendor_code_regex,
      vendor_code_user_editable,
      vendor_code_immutable_after_use,
      vendor_code_sequence_padding,
      vendor_code_next_seq,
      last_event_id
    ) VALUES (
      p_tenant_id,
      'sequential-year',
      NULL,
      0,
      false,
      NULL,
      'manual',
      false,
      'preserve',
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      true,
      true,
      4,
      0,
      gen_random_uuid()::text
    )
    RETURNING * INTO v_settings;
  END IF;

  RETURN v_settings;
END;
$$;

-- Expand auto_inject_tenant_id to read app_metadata.tenantId
CREATE OR REPLACE FUNCTION inventory.auto_inject_tenant_id()
RETURNS TRIGGER AS $$
DECLARE
  jwt_tenant_id uuid;
BEGIN
  jwt_tenant_id := (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid;

  IF jwt_tenant_id IS NULL THEN
    jwt_tenant_id := (auth.jwt() -> 'app_metadata' ->> 'tenantId')::uuid;
  END IF;

  IF jwt_tenant_id IS NULL THEN
    jwt_tenant_id := (auth.jwt() ->> 'tenant_id')::uuid;
  END IF;

  IF jwt_tenant_id IS NULL THEN
    IF NEW.tenant_id IS NULL THEN
      RAISE EXCEPTION 'tenant_id is required when using service role';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.tenant_id IS NOT NULL AND NEW.tenant_id != jwt_tenant_id THEN
    RAISE WARNING 'Attempted to insert with tenant_id=% but JWT has tenant_id=%. Using JWT value.',
      NEW.tenant_id, jwt_tenant_id;
  END IF;

  NEW.tenant_id := jwt_tenant_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
