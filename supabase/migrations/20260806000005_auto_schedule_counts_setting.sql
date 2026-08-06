-- Nightly auto-scheduling of cycle counts from suggestions: opt-in per tenant.
-- Off by default; the auto-schedule-counts cron only runs for tenants that flip
-- this on. On-demand "Schedule these" from the suggestions widget ignores it
-- (it's an explicit admin action).
ALTER TABLE supply_chain.tenant_settings
  ADD COLUMN IF NOT EXISTS auto_schedule_counts_enabled BOOLEAN NOT NULL DEFAULT false;

-- Thread the new column through the settings update whitelist so the settings
-- page can toggle it. (rpc_get_tenant_settings returns SETOF tenant_settings,
-- so reads pick up the column automatically.)
CREATE OR REPLACE FUNCTION supply_chain.rpc_update_tenant_settings(p_updates jsonb)
 RETURNS supply_chain.tenant_settings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'supply_chain', 'public'
AS $function$
DECLARE
  v_tenant_id UUID;
  v_user_id UUID;
  v_role TEXT;
  v_settings supply_chain.tenant_settings;
BEGIN
  v_tenant_id := public.current_tenant_id();
  v_user_id := (auth.jwt() ->> 'user_id')::UUID;
  v_role := auth.jwt() -> 'app_metadata' ->> 'role';

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required - no tenant_id in JWT';
  END IF;

  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Admin role required to update tenant settings';
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
    reorder_mode = COALESCE(p_updates->>'reorder_mode', reorder_mode),
    auto_schedule_counts_enabled = COALESCE((p_updates->>'auto_schedule_counts_enabled')::BOOLEAN, auto_schedule_counts_enabled),
    agent_permissions = COALESCE((p_updates->'agent_permissions')::JSONB, agent_permissions),
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
$function$;
