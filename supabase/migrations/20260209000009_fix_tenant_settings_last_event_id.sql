-- =====================================================================
-- Migration: Fix tenant settings last_event_id + tenantId JWT path
-- Date: 2026-02-09
-- Description: Ensure tenant_settings inserts set last_event_id and
--              current_tenant_id resolves app_metadata.tenantId.
-- =====================================================================

-- Update current_tenant_id to support app_metadata.tenantId
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
    v_tenant_id := (auth.jwt() -> 'app_metadata' ->> 'tenantId')::uuid;
  END IF;

  IF v_tenant_id IS NULL THEN
    v_tenant_id := (auth.jwt() ->> 'tenant_id')::uuid;
  END IF;

  RETURN v_tenant_id;
END;
$$;

-- Ensure new tenant_settings rows always include last_event_id
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

-- Backfill any missing last_event_id values (defensive)
UPDATE supply_chain.tenant_settings
SET last_event_id = COALESCE(last_event_id, 'legacy_sc_tenant_settings_' || id::text)
WHERE last_event_id IS NULL;
