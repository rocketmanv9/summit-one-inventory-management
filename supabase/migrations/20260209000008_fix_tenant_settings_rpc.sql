-- =====================================================================
-- Migration: Fix tenant settings RPC tenant resolution
-- Date: 2026-02-09
-- Description: Use public.current_tenant_id() fallback for JWT paths.
-- =====================================================================

CREATE OR REPLACE FUNCTION supply_chain.rpc_get_tenant_settings()
RETURNS supply_chain.tenant_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO supply_chain, public
AS $$
DECLARE
  v_tenant_id UUID;
  v_settings supply_chain.tenant_settings;
BEGIN
  v_tenant_id := public.current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required - no tenant_id in JWT';
  END IF;

  SELECT * INTO v_settings
  FROM supply_chain.tenant_settings
  WHERE tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    v_settings := supply_chain.get_or_create_tenant_settings(v_tenant_id);
  END IF;

  RETURN v_settings;
END;
$$;

GRANT EXECUTE ON FUNCTION supply_chain.rpc_get_tenant_settings TO authenticated;

CREATE OR REPLACE FUNCTION supply_chain.rpc_update_tenant_settings(p_updates JSONB)
RETURNS supply_chain.tenant_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO supply_chain, public
AS $$
DECLARE
  v_tenant_id UUID;
  v_user_id UUID;
  v_settings supply_chain.tenant_settings;
BEGIN
  v_tenant_id := public.current_tenant_id();
  v_user_id := (auth.jwt() ->> 'user_id')::UUID;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required - no tenant_id in JWT';
  END IF;

  SELECT * INTO v_settings
  FROM supply_chain.tenant_settings
  WHERE tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    v_settings := supply_chain.get_or_create_tenant_settings(v_tenant_id);
  END IF;

  UPDATE supply_chain.tenant_settings
  SET
    po_number_format = COALESCE(p_updates->>'po_number_format', po_number_format),
    po_number_prefix = COALESCE(p_updates->>'po_number_prefix', po_number_prefix),
    auto_approve_enabled = COALESCE((p_updates->>'auto_approve_enabled')::BOOLEAN, auto_approve_enabled),
    auto_approve_limit = COALESCE((p_updates->>'auto_approve_limit')::NUMERIC, auto_approve_limit),
    cycle_count_number_format = COALESCE(p_updates->>'cycle_count_number_format', cycle_count_number_format),
    cycle_count_number_prefix = COALESCE(p_updates->>'cycle_count_number_prefix', cycle_count_number_prefix),
    vendor_auto_approve_limits = COALESCE((p_updates->'vendor_auto_approve_limits')::JSONB, vendor_auto_approve_limits),
    vendor_code_strategy = COALESCE(p_updates->>'vendor_code_strategy', vendor_code_strategy),
    vendor_code_required = COALESCE((p_updates->>'vendor_code_required')::BOOLEAN, vendor_code_required),
    vendor_code_case = COALESCE(p_updates->>'vendor_code_case', vendor_code_case),
    vendor_code_min_length = COALESCE((p_updates->>'vendor_code_min_length')::INTEGER, vendor_code_min_length),
    vendor_code_max_length = COALESCE((p_updates->>'vendor_code_max_length')::INTEGER, vendor_code_max_length),
    vendor_code_prefix = COALESCE(p_updates->>'vendor_code_prefix', vendor_code_prefix),
    vendor_code_suffix = COALESCE(p_updates->>'vendor_code_suffix', vendor_code_suffix),
    vendor_code_allowed_chars = COALESCE(p_updates->>'vendor_code_allowed_chars', vendor_code_allowed_chars),
    vendor_code_regex = COALESCE(p_updates->>'vendor_code_regex', vendor_code_regex),
    vendor_code_user_editable = COALESCE((p_updates->>'vendor_code_user_editable')::BOOLEAN, vendor_code_user_editable),
    vendor_code_immutable_after_use = COALESCE((p_updates->>'vendor_code_immutable_after_use')::BOOLEAN, vendor_code_immutable_after_use),
    vendor_code_sequence_padding = COALESCE((p_updates->>'vendor_code_sequence_padding')::INTEGER, vendor_code_sequence_padding),
    updated_at = NOW(),
    updated_by = v_user_id
  WHERE tenant_id = v_tenant_id
  RETURNING * INTO v_settings;

  RETURN v_settings;
END;
$$;

GRANT EXECUTE ON FUNCTION supply_chain.rpc_update_tenant_settings TO authenticated;
