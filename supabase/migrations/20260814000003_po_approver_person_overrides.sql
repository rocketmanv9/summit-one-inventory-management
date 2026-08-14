-- 20260814000003_po_approver_person_overrides.sql
-- Fully configurable PO approver routing (sprint 2026-08-14 item 02).
--
-- Before this, the resolver had three tiers and only ONE of them was
-- configurable from inventory (the per-location override). The supervisor tier
-- is an HR mirror (correctly read-only here), and the admin pool was an
-- anonymous catch-all nobody could shape. Grant's ask: every leg of the routing
-- should be visible AND changeable from the settings UI.
--
-- Two new configuration surfaces, both ADDITIVE:
--
--   1. Per-PERSON override (new tier 1): supply_chain.po_approver_overrides —
--      "whenever THIS buyer needs sign-off, route to THAT approver", regardless
--      of location or org chart. One override per buyer per tenant. Deactivate
--      instead of delete so the note/author trail survives.
--
--   2. Named fallback approvers (shapes the last tier):
--      tenant_settings.po_fallback_approver_user_ids uuid[]. NULL/empty keeps
--      today's behavior (anonymous admin pool — any admin). Non-empty routes
--      pool-bound POs to the first eligible named person instead, so an
--      over-limit PO always lands in a REAL inbox (the whole anti-"ether"
--      campaign, continued).
--
-- Precedence becomes:
--   person_override → location_override → supervisor → named_fallback → admin_pool
-- Every tier keeps the self-approval guard (an override that resolves to the
-- buyer is skipped, with an honest trace step). resolve_po_approval_route is
-- replaced IN PLACE; the approval_route JSONB shape is extended additively
-- (new step rules 'person_override' / 'named_fallback' — existing consumers
-- render unknown rules via their fallback label path).
--
-- Existing POs untouched. resolve_po_approver still delegates, so the mobile
-- item-09 path and the simulator pick the new tiers up for free.

-- ── 1. Per-person override table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supply_chain.po_approver_overrides (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  buyer_user_id UUID NOT NULL,
  approver_user_id UUID NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  note TEXT,
  created_by_user_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  last_event_id UUID,
  UNIQUE (tenant_id, buyer_user_id)
);

ALTER TABLE supply_chain.po_approver_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY po_approver_overrides_service ON supply_chain.po_approver_overrides
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY po_approver_overrides_tenant ON supply_chain.po_approver_overrides
  FOR ALL TO authenticated
  USING (tenant_id = COALESCE((auth.jwt()->'app_metadata'->>'tenant_id')::uuid, (auth.jwt()->>'tenant_id')::uuid))
  WITH CHECK (tenant_id = COALESCE((auth.jwt()->'app_metadata'->>'tenant_id')::uuid, (auth.jwt()->>'tenant_id')::uuid));

CREATE INDEX IF NOT EXISTS idx_po_approver_overrides_tenant
  ON supply_chain.po_approver_overrides (tenant_id, active);

-- ── 2. Named fallback approvers on tenant_settings ───────────────────────────
ALTER TABLE supply_chain.tenant_settings
  ADD COLUMN IF NOT EXISTS po_fallback_approver_user_ids UUID[];

-- ── 3. Resolver replacement: 5-step precedence with full provenance ──────────
CREATE OR REPLACE FUNCTION supply_chain.resolve_po_approval_route(
  p_tenant_id uuid,
  p_buyer_user_id uuid,
  p_delivery_location_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'supply_chain', 'inventory', 'public'
AS $$
DECLARE
  v_resolved UUID;
  v_rule TEXT := 'admin_pool';
  v_override RECORD;
  v_override_user_exists BOOLEAN;
  v_loc_override UUID;
  v_loc_name TEXT;
  v_supervisor_person UUID;
  v_supervisor_user UUID;
  v_buyer_hr UUID;
  v_fallback_ids UUID[];
  v_fallback_pick UUID;
  v_fallback_count INT;
  v_admin_count INT;
  v_steps JSONB := '[]'::jsonb;
BEGIN
  -- Step 1: per-person override (this buyer → that approver, set in inventory
  -- settings). Skipped when it would mean self-approval or a dead user id.
  IF p_buyer_user_id IS NOT NULL THEN
    SELECT o.approver_user_id, o.note INTO v_override
    FROM supply_chain.po_approver_overrides o
    WHERE o.tenant_id = p_tenant_id
      AND o.buyer_user_id = p_buyer_user_id
      AND o.active;

    IF v_override.approver_user_id IS NOT NULL THEN
      IF v_override.approver_user_id = p_buyer_user_id THEN
        v_steps := v_steps || jsonb_build_object(
          'rule', 'person_override', 'outcome', 'skipped', 'user_id', NULL,
          'detail', 'personal override points at the buyer — can''t approve own PO');
      ELSE
        SELECT EXISTS (
          SELECT 1 FROM public.local_users lu
          WHERE lu.tenant_id = p_tenant_id AND lu.user_id = v_override.approver_user_id
        ) INTO v_override_user_exists;

        IF v_override_user_exists THEN
          v_resolved := v_override.approver_user_id;
          v_rule := 'person_override';
          v_steps := v_steps || jsonb_build_object(
            'rule', 'person_override', 'outcome', 'matched',
            'user_id', v_override.approver_user_id,
            'detail', 'buyer has a personal approver override'
              || COALESCE(' (' || v_override.note || ')', ''));
        ELSE
          v_steps := v_steps || jsonb_build_object(
            'rule', 'person_override', 'outcome', 'unresolved', 'user_id', NULL,
            'detail', 'personal override set but the approver is no longer a user');
        END IF;
      END IF;
    ELSE
      v_steps := v_steps || jsonb_build_object(
        'rule', 'person_override', 'outcome', 'none', 'user_id', NULL,
        'detail', 'no personal override for this buyer');
    END IF;
  ELSE
    v_steps := v_steps || jsonb_build_object(
      'rule', 'person_override', 'outcome', 'none', 'user_id', NULL,
      'detail', 'machine-authored PO — no buyer to override for');
  END IF;

  -- Step 2: location override.
  IF v_resolved IS NULL AND p_delivery_location_id IS NOT NULL THEN
    SELECT po_approver_user_id, name INTO v_loc_override, v_loc_name
    FROM inventory.locations
    WHERE tenant_id = p_tenant_id AND id = p_delivery_location_id;

    IF v_loc_override IS NOT NULL AND v_loc_override <> COALESCE(p_buyer_user_id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
      v_resolved := v_loc_override;
      v_rule := 'location_override';
      v_steps := v_steps || jsonb_build_object(
        'rule', 'location_override', 'outcome', 'matched',
        'user_id', v_loc_override,
        'detail', format('%s has a configured approver', COALESCE(v_loc_name, 'location')));
    ELSIF v_loc_override IS NOT NULL AND v_loc_override = p_buyer_user_id THEN
      v_steps := v_steps || jsonb_build_object(
        'rule', 'location_override', 'outcome', 'skipped', 'user_id', NULL,
        'detail', format('%s approver is the buyer — can''t approve own PO', COALESCE(v_loc_name, 'location')));
    ELSE
      v_steps := v_steps || jsonb_build_object(
        'rule', 'location_override', 'outcome', 'none', 'user_id', NULL,
        'detail', format('%s has no approver configured', COALESCE(v_loc_name, 'location')));
    END IF;
  ELSIF v_resolved IS NULL THEN
    v_steps := v_steps || jsonb_build_object(
      'rule', 'location_override', 'outcome', 'none', 'user_id', NULL,
      'detail', 'no delivery location on the PO');
  END IF;

  -- Step 3: buyer's HR supervisor → their app user.
  IF v_resolved IS NULL THEN
    IF p_buyer_user_id IS NOT NULL THEN
      SELECT hp.supervisor_hr_person_id INTO v_supervisor_person
      FROM public.local_users lu
      JOIN public.hr_people hp
        ON hp.tenant_id = lu.tenant_id AND hp.hr_person_id = lu.hr_person_id
      WHERE lu.tenant_id = p_tenant_id AND lu.user_id = p_buyer_user_id;

      SELECT lu.hr_person_id INTO v_buyer_hr
      FROM public.local_users lu
      WHERE lu.tenant_id = p_tenant_id AND lu.user_id = p_buyer_user_id;
    END IF;

    IF v_supervisor_person IS NOT NULL THEN
      SELECT lu.user_id INTO v_supervisor_user
      FROM public.local_users lu
      WHERE lu.tenant_id = p_tenant_id AND lu.hr_person_id = v_supervisor_person;

      IF v_supervisor_user IS NOT NULL AND v_supervisor_user <> p_buyer_user_id THEN
        v_resolved := v_supervisor_user;
        v_rule := 'supervisor';
        v_steps := v_steps || jsonb_build_object(
          'rule', 'supervisor', 'outcome', 'matched', 'user_id', v_supervisor_user,
          'detail', 'buyer''s supervisor on file');
      ELSIF v_supervisor_user IS NOT NULL THEN
        v_steps := v_steps || jsonb_build_object(
          'rule', 'supervisor', 'outcome', 'skipped', 'user_id', NULL,
          'detail', 'supervisor is the buyer — can''t approve own PO');
      ELSE
        v_steps := v_steps || jsonb_build_object(
          'rule', 'supervisor', 'outcome', 'unresolved', 'user_id', NULL,
          'detail', 'supervisor on file has no app account');
      END IF;
    ELSIF p_buyer_user_id IS NULL THEN
      v_steps := v_steps || jsonb_build_object(
        'rule', 'supervisor', 'outcome', 'none', 'user_id', NULL,
        'detail', 'machine-authored PO — no buyer to route by');
    ELSIF v_buyer_hr IS NULL THEN
      v_steps := v_steps || jsonb_build_object(
        'rule', 'supervisor', 'outcome', 'none', 'user_id', NULL,
        'detail', 'buyer is not linked to an HR person');
    ELSE
      v_steps := v_steps || jsonb_build_object(
        'rule', 'supervisor', 'outcome', 'none', 'user_id', NULL,
        'detail', 'no supervisor on file for this buyer');
    END IF;
  END IF;

  -- Step 4: named fallback approvers (tenant setting). First eligible named
  -- person (real user, not the buyer) gets it — a REAL inbox instead of the
  -- anonymous pool. NULL/empty list = tier disabled (today's behavior).
  IF v_resolved IS NULL THEN
    SELECT ts.po_fallback_approver_user_ids INTO v_fallback_ids
    FROM supply_chain.tenant_settings ts
    WHERE ts.tenant_id = p_tenant_id;
    v_fallback_count := COALESCE(array_length(v_fallback_ids, 1), 0);

    IF v_fallback_count > 0 THEN
      SELECT u.user_id INTO v_fallback_pick
      FROM unnest(v_fallback_ids) WITH ORDINALITY AS f(user_id, ord)
      JOIN public.local_users u
        ON u.tenant_id = p_tenant_id AND u.user_id = f.user_id
      WHERE f.user_id <> COALESCE(p_buyer_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
      ORDER BY f.ord
      LIMIT 1;

      IF v_fallback_pick IS NOT NULL THEN
        v_resolved := v_fallback_pick;
        v_rule := 'named_fallback';
        v_steps := v_steps || jsonb_build_object(
          'rule', 'named_fallback', 'outcome', 'matched', 'user_id', v_fallback_pick,
          'detail', format('first eligible of %s named fallback approver(s)', v_fallback_count));
      ELSE
        v_steps := v_steps || jsonb_build_object(
          'rule', 'named_fallback', 'outcome', 'unresolved', 'user_id', NULL,
          'detail', 'named fallback list set but nobody eligible (buyer or missing users)');
      END IF;
    ELSE
      v_steps := v_steps || jsonb_build_object(
        'rule', 'named_fallback', 'outcome', 'none', 'user_id', NULL,
        'detail', 'no named fallback approvers configured — any admin');
    END IF;
  END IF;

  -- Step 5: admin pool fallback.
  IF v_resolved IS NULL THEN
    SELECT count(*) INTO v_admin_count
    FROM public.local_users
    WHERE tenant_id = p_tenant_id AND role = 'admin';
    v_steps := v_steps || jsonb_build_object(
      'rule', 'admin_pool', 'outcome', 'matched', 'user_id', NULL,
      'detail', format('routes to the admin pool — %s admin(s) can approve, nobody specific', v_admin_count));
  END IF;

  RETURN jsonb_build_object(
    'resolved_rule', v_rule,
    'resolved_user_id', v_resolved,
    'buyer_user_id', p_buyer_user_id,
    'delivery_location_id', p_delivery_location_id,
    'steps', v_steps,
    'resolved_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION supply_chain.resolve_po_approval_route(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION supply_chain.resolve_po_approval_route(uuid, uuid, uuid) TO authenticated, service_role;

-- ── 4. rpc_update_tenant_settings learns the fallback list ───────────────────
-- Recreated with ONE addition: po_fallback_approver_user_ids, key-presence
-- gated (COALESCE can't clear a list — passing null/[] must mean "back to all
-- admins"). Everything else is byte-for-byte the live stage definition.
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
    po_fallback_approver_user_ids = CASE
      WHEN p_updates ? 'po_fallback_approver_user_ids' THEN
        (SELECT array_agg(x::uuid)
         FROM jsonb_array_elements_text(
           CASE WHEN jsonb_typeof(p_updates->'po_fallback_approver_user_ids') = 'array'
                THEN p_updates->'po_fallback_approver_user_ids'
                ELSE '[]'::jsonb END) AS x)
      ELSE po_fallback_approver_user_ids
    END,
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
