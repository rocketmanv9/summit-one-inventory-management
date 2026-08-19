-- 20260819000001_po_vendor_counter_pickup.sql
-- Fix the "pickup_location_id required when delivery_method = pickup" wall.
--
-- Bug (sprint 2026-08-19 item 1): creating a PO with Fulfillment = Pickup and
-- "Pick up from <vendor>" selected (the default, no tenant will-call location)
-- fails with a raw RPC exception. The create-page pickup <select> defaults to a
-- blank value meaning "pick up at the vendor's counter", so pickup_location_id
-- arrives NULL — and rpc_create_purchase_order flatly rejected that.
--
-- But vendor-counter pickup is a first-class, fully-supported case everywhere
-- ELSE:
--   * purchase_orders.pickup_location_id is a NULLABLE uuid with NO FK — it is
--     meant to hold one of the TENANT's own locations for on-site will-call, and
--     "not set" legitimately means "pick up from the vendor".
--   * po-context.ts (loadPOContext) already renders the PICKUP AT block from the
--     vendor's own pickup address (address_type 'pickup', else first on file)
--     precisely when pickup_location_id IS NULL. The PDF/email are correct today.
--
-- So the ONLY thing blocking a vendor-counter pickup PO was this guard. This
-- migration recreates rpc_create_purchase_order with the exact live 17-arg
-- signature (from 20260812000002), changing ONE line: the pickup guard no longer
-- requires a tenant pickup_location_id. A NULL pickup_location_id on a pickup PO
-- now means "pick up from the vendor" — matching the UI copy and po-context.
--
-- Everything else (auto-approve/awaiting-approval routing, branch-pricing
-- provenance via p_vendor_address_id, budgets, spend limits, line insert, event
-- ids) is byte-for-byte the live body. Ship + branch pricing + request-quote are
-- untouched.

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
  -- Pickup: a NULL pickup_location_id is VALID and means "pick up from the
  -- vendor's counter/plant". po-context resolves that block from the vendor's own
  -- pickup address. A non-null value is an on-site will-call at a tenant location.
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

REVOKE ALL ON FUNCTION supply_chain.rpc_create_purchase_order(uuid,text,text,date,text,uuid,uuid,uuid,numeric,text,text,jsonb,jsonb,text,uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION supply_chain.rpc_create_purchase_order(uuid,text,text,date,text,uuid,uuid,uuid,numeric,text,text,jsonb,jsonb,text,uuid,uuid,uuid) TO authenticated, service_role;
