-- 20260812000002_po_approval_route_provenance.sql
-- Approvals audit + visual routing (sprint item 14, Grant 2026-08-12).
--
-- The Zach case: an over-limit PO routed to the anonymous admin pool
-- (approver_user_id NULL) and got approved silently. Nobody could see WHY it
-- routed there, or that it routed nowhere specific. Two structural gaps:
--
--   1. Routing left no trace. The resolver returns a single uuid (or NULL) — it
--      doesn't record which of the three rules matched or what each fallback
--      returned. So a PO in the pool looks identical to one that resolved to a
--      real person; the "ether" is invisible.
--
--   2. "approval_reason" was overloaded. It holds WHY a PO needs approval
--      ("over spend limit", or the AI-restock label). There was no column for
--      the APPROVER'S reason when they sign off — deny captured a reason
--      (rejected_reason) but approve never did.
--
-- This migration is ADDITIVE and backward-compatible:
--   * approved_reason TEXT — the approver's own words on sign-off (mirror of
--     rejected_reason; optional at the API layer for mobile compat).
--   * approval_route JSONB — the structured resolution trace, stored at submit:
--       { resolved_rule, resolved_user_id, buyer_user_id, delivery_location_id,
--         steps: [ { rule, outcome, user_id, detail } ], resolved_at }
--     where resolved_rule ∈ location_override | supervisor | admin_pool.
--   * resolve_po_approval_route(tenant, buyer, location) — a SECURITY DEFINER
--     function that returns BOTH the resolved approver AND the trace, so every
--     PO-creating path records identical provenance without re-implementing the
--     precedence. resolve_po_approver() is preserved (mobile item 09 + the
--     simulator call it) and now delegates to the route resolver.
--   * The three PO-creating RPCs (rpc_create_purchase_order,
--     rpc_submit_po_for_approval, rpc_generate_reorder_pos_v2) store the route.
--   * Provenance fix: the nightly reorder generator stamped machine POs with
--     created_by_user_id = "most recent PO creator" (which is how Zach's name
--     landed on 26-0047 — he happened to be the last human to create a PO). The
--     inbox then read "Zachary Kauffman wants $X" for a PO Zach never touched.
--     Machine-authored reorder POs now carry created_by_user_id = NULL; the
--     resolver's buyer for routing purposes uses a designated fallback but the
--     stored author is honest ("nobody — nightly job"). The route records the
--     machine origin so the trail stays complete.

-- ── 1. Columns ───────────────────────────────────────────────────────────────
ALTER TABLE supply_chain.purchase_orders
  ADD COLUMN IF NOT EXISTS approved_reason TEXT,
  ADD COLUMN IF NOT EXISTS approval_route JSONB;

-- ── 2. Route resolver (approver + structured trace) ──────────────────────────
-- Same precedence as resolve_po_approver (location override → supervisor →
-- admin pool), but returns the whole decision as JSONB so it can be stored and
-- shown. NULL location/buyer are tolerated (machine-authored POs pass a
-- fallback buyer for routing but no honest author).
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
  v_loc_override UUID;
  v_loc_name TEXT;
  v_supervisor_person UUID;
  v_supervisor_user UUID;
  v_buyer_hr UUID;
  v_admin_count INT;
  v_steps JSONB := '[]'::jsonb;
BEGIN
  -- Step 1: location override.
  IF p_delivery_location_id IS NOT NULL THEN
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
  ELSE
    v_steps := v_steps || jsonb_build_object(
      'rule', 'location_override', 'outcome', 'none', 'user_id', NULL,
      'detail', 'no delivery location on the PO');
  END IF;

  -- Step 2: buyer's HR supervisor → their app user.
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

  -- Step 3: admin pool fallback.
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

-- resolve_po_approver now delegates to the route resolver so there is ONE
-- precedence implementation. Signature/behaviour unchanged for existing callers
-- (mobile item 09, the simulator).
CREATE OR REPLACE FUNCTION supply_chain.resolve_po_approver(
  p_tenant_id uuid,
  p_buyer_user_id uuid,
  p_delivery_location_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'supply_chain', 'inventory', 'public'
AS $$
  SELECT (supply_chain.resolve_po_approval_route(p_tenant_id, p_buyer_user_id, p_delivery_location_id)
          ->> 'resolved_user_id')::uuid;
$$;

REVOKE ALL ON FUNCTION supply_chain.resolve_po_approver(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION supply_chain.resolve_po_approver(uuid, uuid, uuid) TO authenticated, service_role;

-- ── 3. Expose the new columns on the read view ───────────────────────────────
CREATE OR REPLACE VIEW inventory.purchase_orders AS
  SELECT id,
    tenant_id,
    po_number,
    vendor_location_id,
    status,
    order_date,
    expected_delivery_date,
    delivery_location_id,
    notes,
    created_by_user_id,
    approved_by_user_id,
    approved_at,
    created_at,
    updated_at,
    updated_by,
    last_event_id,
    vendor_id,
    vendor_name_snapshot,
    vendor_code_snapshot,
    origin,
    approval_reason,
    approver_user_id,
    approved_reason,
    approval_route,
    rejected_reason,
    rejected_by_user_id,
    rejected_at
  FROM supply_chain.purchase_orders;

-- ── 4. Store the route in rpc_submit_po_for_approval ─────────────────────────
CREATE OR REPLACE FUNCTION supply_chain.rpc_submit_po_for_approval(
  p_po_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'supply_chain', 'inventory', 'public'
AS $$
DECLARE
  v_tenant_id UUID; v_user_id UUID; v_po RECORD;
  v_total NUMERIC; v_unpriced INT;
  v_effective_limit NUMERIC; v_cap_ok BOOLEAN;
  v_budget_amount NUMERIC; v_budget_period TEXT; v_budget_anchor DATE;
  v_b_start DATE; v_b_end DATE; v_spent NUMERIC; v_remaining NUMERIC := NULL;
  v_budget_ok BOOLEAN := true;
  v_reason TEXT; v_approver UUID; v_status TEXT;
  v_route JSONB; v_route_buyer UUID;
BEGIN
  v_tenant_id := COALESCE((auth.jwt()->'app_metadata'->>'tenant_id')::UUID,(auth.jwt()->>'tenant_id')::UUID);
  v_user_id := COALESCE((auth.jwt()->'app_metadata'->>'user_id')::UUID,(auth.jwt()->>'user_id')::UUID,(auth.jwt()->>'sub')::UUID);
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Authentication required - no tenant_id in JWT'; END IF;

  SELECT * INTO v_po FROM supply_chain.purchase_orders
  WHERE id = p_po_id AND tenant_id = v_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PO not found'; END IF;
  IF v_po.status NOT IN ('draft', 'awaiting_approval') THEN
    RAISE EXCEPTION 'Only draft POs can be submitted (current status: %)', v_po.status;
  END IF;

  SELECT
    COALESCE(SUM(qty_ordered * COALESCE(unit_cost, estimated_unit_cost, 0)), 0),
    COUNT(*) FILTER (WHERE unit_cost IS NULL AND estimated_unit_cost IS NULL AND status <> 'cancelled')
  INTO v_total, v_unpriced
  FROM supply_chain.purchase_order_lines
  WHERE po_id = p_po_id AND status <> 'cancelled';

  IF v_unpriced > 0 THEN
    RAISE EXCEPTION 'PO still has % unpriced line(s) — enter the vendor''s prices first', v_unpriced;
  END IF;

  v_effective_limit := supply_chain.resolve_spend_limit(
    v_tenant_id, COALESCE(v_po.created_by_user_id, v_user_id), v_po.vendor_id, 'user');
  v_cap_ok := (v_effective_limit IS NULL OR v_total <= v_effective_limit);

  IF v_po.created_by_user_id IS NOT NULL THEN
    SELECT budget_amount, budget_period, budget_anchor INTO v_budget_amount, v_budget_period, v_budget_anchor
    FROM public.local_users WHERE user_id = v_po.created_by_user_id AND tenant_id = v_tenant_id;
    IF v_budget_amount IS NOT NULL AND v_budget_period IS NOT NULL AND v_budget_anchor IS NOT NULL THEN
      SELECT period_start, period_end INTO v_b_start, v_b_end
      FROM supply_chain.budget_period_bounds(v_budget_period, v_budget_anchor, CURRENT_DATE);
      v_spent := supply_chain.user_period_spend(v_tenant_id, v_po.created_by_user_id, v_b_start, v_b_end);
      v_remaining := v_budget_amount - COALESCE(v_spent, 0);
      v_budget_ok := (v_total <= v_remaining);
    END IF;
  END IF;

  IF v_cap_ok AND v_budget_ok THEN
    UPDATE supply_chain.purchase_orders
    SET status = 'approved', approved_at = now(),
        approved_by_user_id = v_user_id,
        approval_reason = NULL, approver_user_id = NULL,
        approval_route = NULL,
        last_event_id = gen_random_uuid()
    WHERE id = p_po_id;
    RETURN jsonb_build_object('status', 'approved', 'total', v_total);
  END IF;

  v_reason := trim(both '; ' from concat_ws('; ',
    CASE WHEN NOT v_cap_ok THEN format('total $%s exceeds spend limit $%s', round(v_total, 2), round(v_effective_limit, 2)) END,
    CASE WHEN NOT v_budget_ok THEN format('total $%s exceeds remaining budget $%s', round(v_total, 2), round(v_remaining, 2)) END));

  -- Route for provenance uses the effective buyer (fallback to actor).
  v_route_buyer := COALESCE(v_po.created_by_user_id, v_user_id);
  v_route := supply_chain.resolve_po_approval_route(v_tenant_id, v_route_buyer, v_po.delivery_location_id);
  v_approver := (v_route->>'resolved_user_id')::uuid;

  UPDATE supply_chain.purchase_orders
  SET status = 'awaiting_approval',
      approval_reason = v_reason,
      approver_user_id = v_approver,
      approval_route = v_route,
      approved_reason = NULL,
      rejected_reason = NULL, rejected_at = NULL, rejected_by_user_id = NULL,
      last_event_id = gen_random_uuid()
  WHERE id = p_po_id;

  RETURN jsonb_build_object('status', 'awaiting_approval', 'total', v_total,
    'reason', v_reason, 'approver_user_id', v_approver, 'approval_route', v_route);
END;
$$;

REVOKE ALL ON FUNCTION supply_chain.rpc_submit_po_for_approval(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION supply_chain.rpc_submit_po_for_approval(uuid) TO authenticated, service_role;

-- ── 5. Store the route in rpc_create_purchase_order ──────────────────────────
-- Extends the live stage definition (params p_tenant_id/p_acting_user_id from
-- 20260807000001): the awaiting_approval branch now resolves the whole route
-- and stores it in approval_route alongside approver_user_id.
CREATE OR REPLACE FUNCTION supply_chain.rpc_create_purchase_order(
  p_vendor_id uuid,
  p_po_number text DEFAULT NULL::text,
  p_delivery_method text DEFAULT 'ship'::text,
  p_needed_by_date date DEFAULT NULL::date,
  p_cost_context text DEFAULT 'overhead'::text,
  p_job_id uuid DEFAULT NULL::uuid,
  p_delivery_location_id uuid DEFAULT NULL::uuid,
  p_pickup_location_id uuid DEFAULT NULL::uuid,
  p_max_authorized_spend numeric DEFAULT NULL::numeric,
  p_vendor_quote_ref text DEFAULT NULL::text,
  p_notes text DEFAULT NULL::text,
  p_attachments jsonb DEFAULT NULL::jsonb,
  p_lines jsonb DEFAULT '[]'::jsonb,
  p_initiated_by text DEFAULT 'user'::text,
  p_vendor_address_id uuid DEFAULT NULL::uuid,
  p_tenant_id uuid DEFAULT NULL::uuid,
  p_acting_user_id uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'supply_chain', 'inventory', 'public'
AS $function$
DECLARE
  v_tenant_id UUID; v_user_id UUID; v_po_id UUID; v_line JSONB; v_line_number INT := 0;
  v_total_estimated_cost NUMERIC := 0; v_has_unknown_pricing BOOLEAN := false;
  v_event_id UUID; v_vendor_name TEXT; v_vendor_code TEXT; v_result JSONB; v_generated_po_number TEXT;
  v_aa_enabled BOOLEAN; v_agent_enabled BOOLEAN; v_effective_limit NUMERIC;
  v_auto_approve BOOLEAN := false; v_status TEXT;
  v_budget_amount NUMERIC; v_budget_period TEXT; v_budget_anchor DATE;
  v_b_start DATE; v_b_end DATE; v_spent NUMERIC; v_remaining NUMERIC := NULL;
  v_cap_ok BOOLEAN; v_budget_ok BOOLEAN := true;
  v_approval_reason TEXT; v_approver UUID; v_route JSONB;
BEGIN
  -- Explicit acting identity is service_role-only: a user JWT can never claim
  -- another tenant or user by passing these params.
  IF (auth.jwt()->>'role') = 'service_role' THEN
    v_tenant_id := COALESCE(p_tenant_id, (auth.jwt()->'app_metadata'->>'tenant_id')::UUID, (auth.jwt()->>'tenant_id')::UUID);
    v_user_id := COALESCE(p_acting_user_id, (auth.jwt()->'app_metadata'->>'user_id')::UUID, (auth.jwt()->>'user_id')::UUID, (auth.jwt()->>'sub')::UUID);
  ELSE
    v_tenant_id := COALESCE((auth.jwt()->'app_metadata'->>'tenant_id')::UUID, (auth.jwt()->>'tenant_id')::UUID);
    v_user_id := COALESCE((auth.jwt()->'app_metadata'->>'user_id')::UUID, (auth.jwt()->>'user_id')::UUID, (auth.jwt()->>'sub')::UUID);
  END IF;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Authentication required - no tenant_id in JWT'; END IF;
  IF p_delivery_method = 'ship' AND p_delivery_location_id IS NULL THEN RAISE EXCEPTION 'delivery_location_id required when delivery_method = ship'; END IF;
  IF p_delivery_method = 'pickup' AND p_pickup_location_id IS NULL THEN RAISE EXCEPTION 'pickup_location_id required when delivery_method = pickup'; END IF;
  IF p_cost_context = 'job' AND p_job_id IS NULL THEN RAISE EXCEPTION 'job_id required when cost_context = job'; END IF;
  IF p_vendor_address_id IS NOT NULL THEN
    PERFORM 1 FROM supply_chain.vendor_addresses va WHERE va.id = p_vendor_address_id AND va.vendor_id = p_vendor_id AND va.tenant_id = v_tenant_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'vendor_address_id does not belong to this vendor'; END IF;
  END IF;
  IF p_po_number IS NULL OR p_po_number = '' THEN v_generated_po_number := supply_chain.generate_po_number(v_tenant_id); ELSE v_generated_po_number := p_po_number; END IF;
  SELECT name, code INTO v_vendor_name, v_vendor_code FROM supply_chain.vendors WHERE id = p_vendor_id AND tenant_id = v_tenant_id;

  SELECT
    COALESCE(SUM((elem->>'qty_ordered')::numeric * COALESCE((elem->>'unit_cost')::numeric, (elem->>'estimated_unit_cost')::numeric, 0)), 0),
    COALESCE(bool_or((elem->>'unit_cost') IS NULL AND (elem->>'estimated_unit_cost') IS NULL), false)
  INTO v_total_estimated_cost, v_has_unknown_pricing
  FROM jsonb_array_elements(p_lines) elem;

  SELECT auto_approve_enabled, agent_auto_order_enabled INTO v_aa_enabled, v_agent_enabled
  FROM supply_chain.tenant_settings WHERE tenant_id = v_tenant_id;
  IF p_initiated_by = 'agent' THEN v_aa_enabled := COALESCE(v_agent_enabled, false); ELSE v_aa_enabled := COALESCE(v_aa_enabled, true); END IF;

  v_effective_limit := supply_chain.resolve_spend_limit(v_tenant_id, v_user_id, p_vendor_id, p_initiated_by);
  v_cap_ok := (v_effective_limit IS NULL OR (NOT v_has_unknown_pricing AND v_total_estimated_cost <= v_effective_limit));

  IF p_initiated_by <> 'agent' AND v_user_id IS NOT NULL THEN
    SELECT budget_amount, budget_period, budget_anchor INTO v_budget_amount, v_budget_period, v_budget_anchor
    FROM public.local_users WHERE user_id = v_user_id AND tenant_id = v_tenant_id;
    IF v_budget_amount IS NOT NULL AND v_budget_period IS NOT NULL AND v_budget_anchor IS NOT NULL THEN
      SELECT period_start, period_end INTO v_b_start, v_b_end
      FROM supply_chain.budget_period_bounds(v_budget_period, v_budget_anchor, CURRENT_DATE);
      v_spent := supply_chain.user_period_spend(v_tenant_id, v_user_id, v_b_start, v_b_end);
      v_remaining := v_budget_amount - COALESCE(v_spent, 0);
      v_budget_ok := (NOT v_has_unknown_pricing) AND (v_total_estimated_cost <= v_remaining);
    END IF;
  END IF;

  v_auto_approve := v_aa_enabled AND v_cap_ok AND v_budget_ok;

  -- Failed auto-approve on KNOWN pricing routes to the approval inbox instead
  -- of dying as a draft. Unknown pricing = quote flow, still a draft until priced.
  IF v_auto_approve THEN
    v_status := 'approved';
  ELSIF v_has_unknown_pricing THEN
    v_status := 'draft';
  ELSE
    v_status := 'awaiting_approval';
    v_approval_reason := trim(both '; ' from concat_ws('; ',
      CASE WHEN NOT v_aa_enabled THEN
        CASE WHEN p_initiated_by = 'agent' THEN 'agent orders require sign-off' ELSE 'auto-approve is off — manager sign-off required' END
      END,
      CASE WHEN v_aa_enabled AND NOT v_cap_ok THEN format('total $%s exceeds spend limit $%s', round(v_total_estimated_cost, 2), round(v_effective_limit, 2)) END,
      CASE WHEN v_aa_enabled AND NOT v_budget_ok THEN format('total $%s exceeds remaining budget $%s', round(v_total_estimated_cost, 2), round(COALESCE(v_remaining, 0), 2)) END));
    -- Store the whole routing decision, not just the resolved id.
    v_route := supply_chain.resolve_po_approval_route(v_tenant_id, v_user_id, p_delivery_location_id);
    v_approver := (v_route->>'resolved_user_id')::uuid;
  END IF;

  v_event_id := gen_random_uuid();
  INSERT INTO supply_chain.purchase_orders (tenant_id, po_number, vendor_id, vendor_address_id, vendor_name_snapshot, vendor_code_snapshot, delivery_method, needed_by_date, cost_context, job_id, delivery_location_id, pickup_location_id, max_authorized_spend, vendor_quote_ref, notes, attachments, status, approved_at, approved_by_user_id, created_by_user_id, order_date, last_event_id, approval_reason, approver_user_id, approval_route)
  VALUES (v_tenant_id, v_generated_po_number, p_vendor_id, p_vendor_address_id, v_vendor_name, v_vendor_code, p_delivery_method, p_needed_by_date, p_cost_context, p_job_id, p_delivery_location_id, p_pickup_location_id, p_max_authorized_spend, p_vendor_quote_ref, p_notes, p_attachments, v_status, CASE WHEN v_auto_approve THEN now() ELSE NULL END, CASE WHEN v_auto_approve THEN v_user_id ELSE NULL END, v_user_id, CURRENT_DATE, v_event_id, v_approval_reason, v_approver, v_route) RETURNING id INTO v_po_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_line_number := v_line_number + 1;
    -- Per-line event id: lines are UNIQUE (tenant_id, last_event_id).
    INSERT INTO supply_chain.purchase_order_lines (tenant_id, po_id, line_number, catalog_item_id, item_description, uom_term_id, qty_ordered, unit_cost, estimated_unit_cost, price_basis, is_approximate_qty, line_notes, status, last_event_id)
    VALUES (v_tenant_id, v_po_id, v_line_number, (v_line->>'catalog_item_id')::UUID, v_line->>'item_description', (v_line->>'uom_term_id')::UUID, (v_line->>'qty_ordered')::NUMERIC, (v_line->>'unit_cost')::NUMERIC, (v_line->>'estimated_unit_cost')::NUMERIC, COALESCE(v_line->>'price_basis','fixed'), COALESCE((v_line->>'is_approximate_qty')::BOOLEAN,false), v_line->>'line_notes', 'pending', gen_random_uuid());
  END LOOP;

  v_result := jsonb_build_object('success',true,'po_id',v_po_id,'po_number',v_generated_po_number,'line_count',v_line_number,'status',v_status,'auto_approved',v_auto_approve,'effective_limit',v_effective_limit,'budget_remaining',v_remaining,'initiated_by',p_initiated_by,'approval_reason',v_approval_reason,'approver_user_id',v_approver,'approval_route',v_route);
  RETURN v_result;
END;
$function$;

-- ── 6. Reorder generator: store route + fix the provenance mislabel ──────────
-- Two changes to rpc_generate_reorder_pos_v2:
--   * Machine-authored POs get created_by_user_id = NULL. Previously it stamped
--     "the most recent PO creator" (v_fallback_user), which is exactly how
--     Zach's name landed on 26-0047 — he was the last human to create a PO, so
--     the nightly job attributed its work to him and the inbox read "Zach wants
--     $X". The buyer used FOR ROUTING is still that fallback (so the resolver
--     has someone's supervisor/location to key off), but the stored author is
--     honest: nobody. The inbox renders origin=auto_reorder as "Nightly
--     auto-reorder", never a person's name.
--   * The finished PO stores approval_route so the trail shows it was a machine
--     draft routed to the pool (or wherever the fallback resolves).
CREATE OR REPLACE FUNCTION supply_chain.rpc_generate_reorder_pos_v2(
  p_tenant_id UUID,
  p_run_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'supply_chain', 'inventory', 'public'
AS $$
DECLARE
  v_run TEXT := COALESCE(p_run_id, to_char(now(), 'YYYYMMDD'));
  v_group RECORD;
  v_sugg RECORD;
  v_po_id UUID;
  v_po_number TEXT;
  v_line_number INT;
  v_po_total NUMERIC;
  v_fallback_user UUID;
  v_approver UUID;
  v_route JSONB;
  v_created JSONB := '[]'::jsonb;
  v_skipped INT := 0;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'p_tenant_id is required';
  END IF;

  -- Routing needs SOMEONE to key supervisor/location resolution off; reuse the
  -- most recent human PO creator. This is a ROUTING input only — it is NOT
  -- written to created_by_user_id (that would misattribute the machine's work).
  SELECT po.created_by_user_id INTO v_fallback_user
  FROM supply_chain.purchase_orders po
  WHERE po.tenant_id = p_tenant_id AND po.created_by_user_id IS NOT NULL
  ORDER BY po.created_at DESC
  LIMIT 1;

  FOR v_group IN
    SELECT rs.preferred_vendor_id AS vendor_id, rs.location_id
    FROM inventory.v_reorder_suggestions rs
    WHERE rs.tenant_id = p_tenant_id
      AND rs.preferred_vendor_id IS NOT NULL
      AND rs.suggested_order_qty > 0
      AND NOT EXISTS (
        SELECT 1
        FROM supply_chain.purchase_order_lines pol
        JOIN supply_chain.purchase_orders po ON po.id = pol.po_id
        WHERE po.tenant_id = p_tenant_id
          AND pol.catalog_item_id = rs.catalog_item_id
          AND po.status NOT IN ('cancelled', 'voided', 'closed', 'fully_received')
      )
    GROUP BY rs.preferred_vendor_id, rs.location_id
  LOOP
    v_po_number := supply_chain.generate_po_number(p_tenant_id);

    -- created_by_user_id NULL: the nightly job, not a person. The inbox renders
    -- origin=auto_reorder specially so a null author never reads as a name.
    INSERT INTO supply_chain.purchase_orders (
      tenant_id, po_number, vendor_id, status, origin,
      delivery_method, delivery_location_id, cost_context,
      order_date, needed_by_date, notes,
      created_by_user_id, vendor_name_snapshot, vendor_code_snapshot,
      last_event_id
    )
    SELECT
      p_tenant_id, v_po_number, v_group.vendor_id, 'draft', 'auto_reorder',
      'ship', v_group.location_id, 'overhead',
      CURRENT_DATE, CURRENT_DATE + 7,
      'Auto-generated by nightly reorder (run ' || v_run || ')',
      NULL, v.name, v.code,
      'auto-reorder-' || v_run || '-' || v_group.vendor_id || '-' || v_group.location_id
    FROM supply_chain.vendors v
    WHERE v.id = v_group.vendor_id AND v.tenant_id = p_tenant_id
    ON CONFLICT (tenant_id, last_event_id) DO NOTHING
    RETURNING id INTO v_po_id;

    IF v_po_id IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_line_number := 0;
    v_po_total := 0;

    FOR v_sugg IN
      SELECT rs.catalog_item_id, rs.suggested_order_qty, rs.estimated_unit_cost
      FROM inventory.v_reorder_suggestions rs
      WHERE rs.tenant_id = p_tenant_id
        AND rs.preferred_vendor_id = v_group.vendor_id
        AND rs.location_id = v_group.location_id
        AND rs.suggested_order_qty > 0
        AND NOT EXISTS (
          SELECT 1
          FROM supply_chain.purchase_order_lines pol
          JOIN supply_chain.purchase_orders po ON po.id = pol.po_id
          WHERE po.tenant_id = p_tenant_id
            AND po.id <> v_po_id
            AND pol.catalog_item_id = rs.catalog_item_id
            AND po.status NOT IN ('cancelled', 'voided', 'closed', 'fully_received')
        )
      ORDER BY rs.catalog_item_id
    LOOP
      v_line_number := v_line_number + 1;
      INSERT INTO supply_chain.purchase_order_lines (
        tenant_id, po_id, line_number, catalog_item_id,
        qty_ordered, unit_cost, estimated_unit_cost, status, last_event_id
      ) VALUES (
        p_tenant_id, v_po_id, v_line_number, v_sugg.catalog_item_id,
        v_sugg.suggested_order_qty, v_sugg.estimated_unit_cost, v_sugg.estimated_unit_cost,
        'pending',
        'auto-reorder-' || v_run || '-' || v_po_id || '-' || v_line_number
      )
      ON CONFLICT (tenant_id, last_event_id) DO NOTHING;

      v_po_total := v_po_total
        + v_sugg.suggested_order_qty * COALESCE(v_sugg.estimated_unit_cost, 0);
    END LOOP;

    IF v_line_number = 0 THEN
      DELETE FROM supply_chain.purchase_orders WHERE id = v_po_id;
      CONTINUE;
    END IF;

    -- Resolve + store the route. Buyer for routing is the fallback human (so
    -- supervisor/location logic has something to key off); the trace records
    -- the machine origin.
    v_route := supply_chain.resolve_po_approval_route(
      p_tenant_id, v_fallback_user, v_group.location_id);
    v_approver := (v_route->>'resolved_user_id')::uuid;

    UPDATE supply_chain.purchase_orders
    SET status = 'awaiting_approval',
        approval_reason = 'AI restock draft — nightly reorder (run ' || v_run || ')',
        approver_user_id = v_approver,
        approval_route = v_route
    WHERE id = v_po_id;

    v_created := v_created || jsonb_build_object(
      'po_id', v_po_id,
      'po_number', v_po_number,
      'vendor_id', v_group.vendor_id,
      'location_id', v_group.location_id,
      'line_count', v_line_number,
      'estimated_total', v_po_total,
      'origin', 'auto_reorder',
      'status', 'awaiting_approval'
    );
  END LOOP;

  RETURN jsonb_build_object(
    'run_id', v_run,
    'created', v_created,
    'created_count', jsonb_array_length(v_created),
    'skipped_existing', v_skipped
  );
END;
$$;
