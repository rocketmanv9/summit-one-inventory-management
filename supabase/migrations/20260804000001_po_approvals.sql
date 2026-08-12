-- 20260804000001_po_approvals.sql
-- Rework P2: the manager approval inbox (Grant, 2026-08-04).
--
-- Today an over-limit PO silently parks as 'draft' — the buyer thinks they
-- ordered, nothing happens. Now it lands as 'awaiting_approval' (status
-- already in the check constraint, never used until now) with the reason
-- recorded and an approver resolved:
--   1. the delivery location's configured approver (locations.po_approver_user_id)
--   2. else the buyer's HR supervisor (hr_people.supervisor_hr_person_id,
--      mirrored from HR org_person_supervisors)
--   3. else null — any admin can approve.
-- Nobody approves their own PO (enforced in the route).
--
-- Quote POs (unknown pricing) stay 'draft' until the vendor prices them, then
-- rpc_submit_po_for_approval runs the same cap/budget check → approved or
-- awaiting_approval. Amazon punchout gates between cart-return and submit
-- (route-side, same resolver).

-- ── Columns ──────────────────────────────────────────────────────────────────
ALTER TABLE supply_chain.purchase_orders
  ADD COLUMN IF NOT EXISTS approver_user_id UUID,
  ADD COLUMN IF NOT EXISTS approval_reason TEXT,
  ADD COLUMN IF NOT EXISTS rejected_by_user_id UUID,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_reason TEXT;

-- Supervisor edge on the HR mirror (populated by /api/hr/sync going forward;
-- backfilled from HR org_person_supervisors at migration time by the app).
ALTER TABLE public.hr_people
  ADD COLUMN IF NOT EXISTS supervisor_hr_person_id UUID;

-- Per-location approver override ("configurable by location").
ALTER TABLE inventory.locations
  ADD COLUMN IF NOT EXISTS po_approver_user_id UUID;

CREATE INDEX IF NOT EXISTS idx_purchase_orders_awaiting
  ON supply_chain.purchase_orders (tenant_id, approver_user_id)
  WHERE status = 'awaiting_approval';

-- ── Approver resolution ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION supply_chain.resolve_po_approver(
  p_tenant_id uuid,
  p_buyer_user_id uuid,
  p_delivery_location_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'supply_chain', 'inventory', 'public'
AS $$
DECLARE
  v_approver UUID;
  v_supervisor_person UUID;
BEGIN
  -- 1. Location override
  IF p_delivery_location_id IS NOT NULL THEN
    SELECT po_approver_user_id INTO v_approver
    FROM inventory.locations
    WHERE tenant_id = p_tenant_id AND id = p_delivery_location_id;
    IF v_approver IS NOT NULL AND v_approver <> p_buyer_user_id THEN
      RETURN v_approver;
    END IF;
  END IF;

  -- 2. Buyer's HR supervisor → their app user
  SELECT hp.supervisor_hr_person_id INTO v_supervisor_person
  FROM public.local_users lu
  JOIN public.hr_people hp
    ON hp.tenant_id = lu.tenant_id AND hp.hr_person_id = lu.hr_person_id
  WHERE lu.tenant_id = p_tenant_id AND lu.user_id = p_buyer_user_id;

  IF v_supervisor_person IS NOT NULL THEN
    SELECT lu.user_id INTO v_approver
    FROM public.local_users lu
    WHERE lu.tenant_id = p_tenant_id AND lu.hr_person_id = v_supervisor_person;
    IF v_approver IS NOT NULL AND v_approver <> p_buyer_user_id THEN
      RETURN v_approver;
    END IF;
  END IF;

  -- 3. Nobody resolvable — null means "any admin".
  RETURN NULL;
END;
$$;

-- ── Submit a priced draft for the limit check ────────────────────────────────
-- Quote POs are created as drafts (unknown money). Once the vendor's prices
-- are on the lines, this runs the exact cap/budget logic creation uses:
-- within limits → approved; over → awaiting_approval with reason + approver.
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
        last_event_id = gen_random_uuid()
    WHERE id = p_po_id;
    RETURN jsonb_build_object('status', 'approved', 'total', v_total);
  END IF;

  v_reason := trim(both '; ' from concat_ws('; ',
    CASE WHEN NOT v_cap_ok THEN format('total $%s exceeds spend limit $%s', round(v_total, 2), round(v_effective_limit, 2)) END,
    CASE WHEN NOT v_budget_ok THEN format('total $%s exceeds remaining budget $%s', round(v_total, 2), round(v_remaining, 2)) END));
  v_approver := supply_chain.resolve_po_approver(
    v_tenant_id, COALESCE(v_po.created_by_user_id, v_user_id), v_po.delivery_location_id);

  UPDATE supply_chain.purchase_orders
  SET status = 'awaiting_approval',
      approval_reason = v_reason,
      approver_user_id = v_approver,
      rejected_reason = NULL, rejected_at = NULL, rejected_by_user_id = NULL,
      last_event_id = gen_random_uuid()
  WHERE id = p_po_id;

  RETURN jsonb_build_object('status', 'awaiting_approval', 'total', v_total,
    'reason', v_reason, 'approver_user_id', v_approver);
END;
$$;

REVOKE ALL ON FUNCTION supply_chain.rpc_submit_po_for_approval(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION supply_chain.rpc_submit_po_for_approval(uuid) TO authenticated, service_role;

-- ── rpc_create_purchase_order: over-limit → awaiting_approval, not dead draft ─
-- Same body as 20260728000001 (per-line event ids preserved) with one change:
-- when auto-approve fails on KNOWN pricing (cap/budget/auto-approve off), the
-- PO lands 'awaiting_approval' with the reason + resolved approver. Unknown
-- pricing (request-a-quote) still lands 'draft' — approving unknown money is
-- meaningless; rpc_submit_po_for_approval runs the check once it's priced.
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
  p_vendor_address_id uuid DEFAULT NULL::uuid
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
  v_approval_reason TEXT; v_approver UUID;
BEGIN
  v_tenant_id := COALESCE((auth.jwt()->'app_metadata'->>'tenant_id')::UUID,(auth.jwt()->>'tenant_id')::UUID);
  v_user_id := COALESCE((auth.jwt()->'app_metadata'->>'user_id')::UUID,(auth.jwt()->>'user_id')::UUID,(auth.jwt()->>'sub')::UUID);
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

  -- The rework (2026-08-04): failed auto-approve on KNOWN pricing routes to
  -- the approval inbox instead of dying as a draft. Unknown pricing = quote
  -- flow, still a draft until priced.
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
    v_approver := supply_chain.resolve_po_approver(v_tenant_id, v_user_id, p_delivery_location_id);
  END IF;

  v_event_id := gen_random_uuid();
  INSERT INTO supply_chain.purchase_orders (tenant_id, po_number, vendor_id, vendor_address_id, vendor_name_snapshot, vendor_code_snapshot, delivery_method, needed_by_date, cost_context, job_id, delivery_location_id, pickup_location_id, max_authorized_spend, vendor_quote_ref, notes, attachments, status, approved_at, approved_by_user_id, created_by_user_id, order_date, last_event_id, approval_reason, approver_user_id)
  VALUES (v_tenant_id, v_generated_po_number, p_vendor_id, p_vendor_address_id, v_vendor_name, v_vendor_code, p_delivery_method, p_needed_by_date, p_cost_context, p_job_id, p_delivery_location_id, p_pickup_location_id, p_max_authorized_spend, p_vendor_quote_ref, p_notes, p_attachments, v_status, CASE WHEN v_auto_approve THEN now() ELSE NULL END, CASE WHEN v_auto_approve THEN v_user_id ELSE NULL END, v_user_id, CURRENT_DATE, v_event_id, v_approval_reason, v_approver) RETURNING id INTO v_po_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_line_number := v_line_number + 1;
    -- Per-line event id: lines are UNIQUE (tenant_id, last_event_id).
    INSERT INTO supply_chain.purchase_order_lines (tenant_id, po_id, line_number, catalog_item_id, item_description, uom_term_id, qty_ordered, unit_cost, estimated_unit_cost, price_basis, is_approximate_qty, line_notes, status, last_event_id)
    VALUES (v_tenant_id, v_po_id, v_line_number, (v_line->>'catalog_item_id')::UUID, v_line->>'item_description', (v_line->>'uom_term_id')::UUID, (v_line->>'qty_ordered')::NUMERIC, (v_line->>'unit_cost')::NUMERIC, (v_line->>'estimated_unit_cost')::NUMERIC, COALESCE(v_line->>'price_basis','fixed'), COALESCE((v_line->>'is_approximate_qty')::BOOLEAN,false), v_line->>'line_notes', 'pending', gen_random_uuid());
  END LOOP;

  v_result := jsonb_build_object('success',true,'po_id',v_po_id,'po_number',v_generated_po_number,'line_count',v_line_number,'status',v_status,'auto_approved',v_auto_approve,'effective_limit',v_effective_limit,'budget_remaining',v_remaining,'initiated_by',p_initiated_by,'approval_reason',v_approval_reason,'approver_user_id',v_approver);
  RETURN v_result;
END;
$function$;
