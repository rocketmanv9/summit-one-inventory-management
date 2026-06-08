-- Per-user PERIODIC spend budgets (cumulative), on top of the per-order caps.
--
-- Adds an optional recurring budget to each app user: a $ amount that accumulates
-- approved PO spend over a calendar period (weekly/monthly/quarterly/annual) anchored
-- to a chosen date, and "resets" automatically when the period window rolls over (no
-- cron — the window is computed live from the anchor).
--
-- Gate semantics (BOTH must pass for a human PO to auto-approve, else it goes to draft):
--   1. per-order cap     : this PO's total <= resolve_spend_limit(...)        (existing)
--   2. period budget     : this PO's total <= (budget_amount - spent_this_period)  (NEW)
-- "spent_this_period" = sum of this user's committed PO line totals whose approved_at
-- falls in the current window. Voided/cancelled/draft POs don't count, so cancelling
-- frees the budget automatically. Agent POs use their own cap and are not budget-gated.

-- ============================================================
-- 1. Per-user budget columns
-- ============================================================
ALTER TABLE public.local_users ADD COLUMN IF NOT EXISTS budget_amount NUMERIC(12,2);   -- per-period cumulative cap (NULL = no budget)
ALTER TABLE public.local_users ADD COLUMN IF NOT EXISTS budget_period TEXT;             -- weekly | monthly | quarterly | annual
ALTER TABLE public.local_users ADD COLUMN IF NOT EXISTS budget_anchor DATE;             -- period start reference; periods step from here

ALTER TABLE public.local_users DROP CONSTRAINT IF EXISTS local_users_budget_period_chk;
ALTER TABLE public.local_users ADD CONSTRAINT local_users_budget_period_chk
  CHECK (budget_period IS NULL OR budget_period IN ('weekly','monthly','quarterly','annual'));

ALTER TABLE public.local_users DROP CONSTRAINT IF EXISTS local_users_budget_complete_chk;
ALTER TABLE public.local_users ADD CONSTRAINT local_users_budget_complete_chk
  CHECK (budget_amount IS NULL OR (budget_period IS NOT NULL AND budget_anchor IS NOT NULL));

-- ============================================================
-- 2. budget_period_bounds() — the [start, end) window containing p_ref
-- ============================================================
-- Steps the period length from the anchor to find the window that contains p_ref.
-- Month-based steps preserve the anchor's day-of-month (Postgres clamps short months).
CREATE OR REPLACE FUNCTION supply_chain.budget_period_bounds(
  p_period TEXT,
  p_anchor DATE,
  p_ref    DATE DEFAULT CURRENT_DATE
) RETURNS TABLE(period_start DATE, period_end DATE)
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_step_months INT;
  v_months      INT;
  v_start       DATE;
BEGIN
  IF p_period = 'weekly' THEN
    v_start := p_anchor + (FLOOR((p_ref - p_anchor)::numeric / 7.0)::int * 7);
    period_start := v_start;
    period_end   := v_start + 7;
    RETURN NEXT;
    RETURN;
  END IF;

  v_step_months := CASE p_period WHEN 'monthly' THEN 1 WHEN 'quarterly' THEN 3 WHEN 'annual' THEN 12 END;
  IF v_step_months IS NULL THEN
    RAISE EXCEPTION 'invalid budget period: %', p_period;
  END IF;

  -- whole months between anchor and ref, floored to a multiple of the step
  v_months := (EXTRACT(year FROM p_ref)::int - EXTRACT(year FROM p_anchor)::int) * 12
            + (EXTRACT(month FROM p_ref)::int - EXTRACT(month FROM p_anchor)::int);
  v_months := (FLOOR(v_months::numeric / v_step_months)::int) * v_step_months;
  v_start  := (p_anchor + make_interval(months => v_months))::date;

  -- correct for day-of-month boundary effects
  IF v_start > p_ref THEN
    v_months := v_months - v_step_months;
    v_start  := (p_anchor + make_interval(months => v_months))::date;
  END IF;
  WHILE (p_anchor + make_interval(months => v_months + v_step_months))::date <= p_ref LOOP
    v_months := v_months + v_step_months;
    v_start  := (p_anchor + make_interval(months => v_months))::date;
  END LOOP;

  period_start := v_start;
  period_end   := (p_anchor + make_interval(months => v_months + v_step_months))::date;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION supply_chain.budget_period_bounds(TEXT, DATE, DATE) IS
  'Returns the [period_start, period_end) calendar window containing p_ref for a budget anchored at p_anchor.';

-- ============================================================
-- 3. user_period_spend() — committed PO spend for a user in a window
-- ============================================================
-- Sums line totals (qty * fixed-or-estimated unit cost) of this user's POs that are in a
-- committed status and whose approved_at falls inside [p_start, p_end). draft/awaiting/
-- cancelled/voided are excluded, so they don't consume (or they release) budget.
CREATE OR REPLACE FUNCTION supply_chain.user_period_spend(
  p_tenant UUID,
  p_user   UUID,
  p_start  DATE,
  p_end    DATE
) RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'supply_chain','public' AS $$
  SELECT COALESCE(SUM(pol.qty_ordered * COALESCE(pol.unit_cost, pol.estimated_unit_cost, 0)), 0)
  FROM supply_chain.purchase_orders po
  JOIN supply_chain.purchase_order_lines pol
    ON pol.po_id = po.id AND pol.tenant_id = po.tenant_id
  WHERE po.tenant_id = p_tenant
    AND po.created_by_user_id = p_user
    AND po.status IN ('approved','sent','placed','acknowledged','partially_received','fully_received','closed')
    AND po.approved_at IS NOT NULL
    AND po.approved_at >= p_start::timestamptz
    AND po.approved_at <  p_end::timestamptz;
$$;

-- ============================================================
-- 4. tenant_user_budgets() — one row per user that has a budget (for the UI)
-- ============================================================
CREATE OR REPLACE FUNCTION supply_chain.tenant_user_budgets(p_tenant UUID)
RETURNS TABLE(
  user_id       UUID,
  budget_amount NUMERIC,
  budget_period TEXT,
  budget_anchor DATE,
  period_start  DATE,
  period_end    DATE,
  spent         NUMERIC,
  remaining     NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'supply_chain','public' AS $$
BEGIN
  RETURN QUERY
  SELECT
    lu.user_id, lu.budget_amount, lu.budget_period, lu.budget_anchor,
    b.period_start, b.period_end,
    COALESCE(sp.spent, 0) AS spent,
    (lu.budget_amount - COALESCE(sp.spent, 0)) AS remaining
  FROM public.local_users lu
  CROSS JOIN LATERAL supply_chain.budget_period_bounds(lu.budget_period, lu.budget_anchor, CURRENT_DATE) b
  CROSS JOIN LATERAL (SELECT supply_chain.user_period_spend(p_tenant, lu.user_id, b.period_start, b.period_end) AS spent) sp
  WHERE lu.tenant_id = p_tenant
    AND lu.budget_amount IS NOT NULL;
END;
$$;

-- ============================================================
-- 5. rpc_create_purchase_order: add the period-budget gate + record created_by_user_id
--    (signature unchanged from 20260605000002, so CREATE OR REPLACE is clean)
-- ============================================================
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
  p_initiated_by text DEFAULT 'user'::text
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
  -- period-budget gate
  v_budget_amount NUMERIC; v_budget_period TEXT; v_budget_anchor DATE;
  v_b_start DATE; v_b_end DATE; v_spent NUMERIC; v_remaining NUMERIC := NULL;
  v_cap_ok BOOLEAN; v_budget_ok BOOLEAN := true;
BEGIN
  v_tenant_id := COALESCE((auth.jwt()->'app_metadata'->>'tenant_id')::UUID,(auth.jwt()->>'tenant_id')::UUID);
  v_user_id := COALESCE((auth.jwt()->'app_metadata'->>'user_id')::UUID,(auth.jwt()->>'user_id')::UUID,(auth.jwt()->>'sub')::UUID);
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Authentication required - no tenant_id in JWT'; END IF;
  IF p_delivery_method = 'ship' AND p_delivery_location_id IS NULL THEN RAISE EXCEPTION 'delivery_location_id required when delivery_method = ship'; END IF;
  IF p_delivery_method = 'pickup' AND p_pickup_location_id IS NULL THEN RAISE EXCEPTION 'pickup_location_id required when delivery_method = pickup'; END IF;
  IF p_cost_context = 'job' AND p_job_id IS NULL THEN RAISE EXCEPTION 'job_id required when cost_context = job'; END IF;
  IF p_po_number IS NULL OR p_po_number = '' THEN v_generated_po_number := supply_chain.generate_po_number(v_tenant_id); ELSE v_generated_po_number := p_po_number; END IF;
  SELECT name, code INTO v_vendor_name, v_vendor_code FROM supply_chain.vendors WHERE id = p_vendor_id AND tenant_id = v_tenant_id;

  -- Pre-compute order total + unknown-pricing flag to drive the auto-approve decision.
  SELECT
    COALESCE(SUM((elem->>'qty_ordered')::numeric * COALESCE((elem->>'unit_cost')::numeric, (elem->>'estimated_unit_cost')::numeric, 0)), 0),
    COALESCE(bool_or((elem->>'unit_cost') IS NULL AND (elem->>'estimated_unit_cost') IS NULL), false)
  INTO v_total_estimated_cost, v_has_unknown_pricing
  FROM jsonb_array_elements(p_lines) elem;

  -- Read the relevant enable flag. Human POs honor auto_approve_enabled (defaults ON);
  -- agent POs honor agent_auto_order_enabled (defaults OFF so the agent can't silently approve).
  SELECT auto_approve_enabled, agent_auto_order_enabled
  INTO v_aa_enabled, v_agent_enabled
  FROM supply_chain.tenant_settings WHERE tenant_id = v_tenant_id;

  IF p_initiated_by = 'agent' THEN
    v_aa_enabled := COALESCE(v_agent_enabled, false);
  ELSE
    v_aa_enabled := COALESCE(v_aa_enabled, true);
  END IF;

  -- Gate 1: per-order cap via the precedence cascade (vendor > user > position > tenant; agent uses its own).
  v_effective_limit := supply_chain.resolve_spend_limit(v_tenant_id, v_user_id, p_vendor_id, p_initiated_by);
  v_cap_ok := (v_effective_limit IS NULL OR (NOT v_has_unknown_pricing AND v_total_estimated_cost <= v_effective_limit));

  -- Gate 2: per-user period budget (humans only; agent is governed by its own cap).
  IF p_initiated_by <> 'agent' AND v_user_id IS NOT NULL THEN
    SELECT budget_amount, budget_period, budget_anchor
      INTO v_budget_amount, v_budget_period, v_budget_anchor
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
  v_status := CASE WHEN v_auto_approve THEN 'approved' ELSE 'draft' END;

  v_event_id := gen_random_uuid();
  INSERT INTO supply_chain.purchase_orders (tenant_id, po_number, vendor_id, vendor_name_snapshot, vendor_code_snapshot, delivery_method, needed_by_date, cost_context, job_id, delivery_location_id, pickup_location_id, max_authorized_spend, vendor_quote_ref, notes, attachments, status, approved_at, approved_by_user_id, created_by_user_id, order_date, last_event_id)
  VALUES (v_tenant_id, v_generated_po_number, p_vendor_id, v_vendor_name, v_vendor_code, p_delivery_method, p_needed_by_date, p_cost_context, p_job_id, p_delivery_location_id, p_pickup_location_id, p_max_authorized_spend, p_vendor_quote_ref, p_notes, p_attachments, v_status, CASE WHEN v_auto_approve THEN now() ELSE NULL END, CASE WHEN v_auto_approve THEN v_user_id ELSE NULL END, v_user_id, CURRENT_DATE, v_event_id) RETURNING id INTO v_po_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_line_number := v_line_number + 1;
    INSERT INTO supply_chain.purchase_order_lines (tenant_id, po_id, line_number, catalog_item_id, item_description, uom_term_id, qty_ordered, unit_cost, estimated_unit_cost, price_basis, is_approximate_qty, line_notes, status, last_event_id)
    VALUES (v_tenant_id, v_po_id, v_line_number, (v_line->>'catalog_item_id')::UUID, v_line->>'item_description', (v_line->>'uom_term_id')::UUID, (v_line->>'qty_ordered')::NUMERIC, (v_line->>'unit_cost')::NUMERIC, (v_line->>'estimated_unit_cost')::NUMERIC, COALESCE(v_line->>'price_basis','fixed'), COALESCE((v_line->>'is_approximate_qty')::BOOLEAN,false), v_line->>'line_notes', 'pending', v_event_id);
  END LOOP;

  v_result := jsonb_build_object('success',true,'po_id',v_po_id,'po_number',v_generated_po_number,'line_count',v_line_number,'status',v_status,'auto_approved',v_auto_approve,'effective_limit',v_effective_limit,'budget_remaining',v_remaining,'initiated_by',p_initiated_by);
  RETURN v_result;
END;
$function$;
