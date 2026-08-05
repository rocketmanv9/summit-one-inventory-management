-- Fix: rejecting a PO from the approvals inbox 500'd on stage.
--
-- The reject route (POST /api/inventory/purchasing/approvals/[id]) sends a PO
-- from 'awaiting_approval' back to 'draft' so the buyer can fix and resubmit,
-- stamping rejected_at / rejected_by_user_id / rejected_reason. But
-- validate_po_status_transition() blanket-forbids any -> 'draft' move
-- ("Cannot return PO to draft status"), so the real reject never committed.
--
-- Smallest correct fix: allow awaiting_approval -> draft ONLY when a rejection
-- is actually being recorded (rejected_at freshly set on this update). Every
-- other backwards-to-draft move stays blocked. No new status, so nothing that
-- enumerates PO statuses changes (purchasing list filters, order-context's
-- OPEN_PO_STATUSES from item 04 already counts 'draft' as open, approvals
-- queries, Denied tab = rejected_at IS NOT NULL). rpc_submit_po_for_approval
-- still clears the rejected_* stamps on resubmit, so the denial self-heals.

CREATE OR REPLACE FUNCTION "supply_chain"."validate_po_status_transition"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    -- Allow any transition from draft
    IF OLD.status = 'draft' THEN
        RETURN NEW;
    END IF;

    -- Prevent invalid transitions
    IF OLD.status = 'cancelled' AND NEW.status != 'cancelled' THEN
        RAISE EXCEPTION 'Cannot change status of cancelled PO';
    END IF;

    IF OLD.status = 'closed' AND NEW.status != 'closed' THEN
        RAISE EXCEPTION 'Cannot change status of closed PO';
    END IF;

    -- A rejection sends an awaiting-approval PO back to draft so the buyer can
    -- revise and resubmit. Permit that one backwards move, but only when the
    -- rejection is actually being stamped on this update.
    IF NEW.status = 'draft'
       AND OLD.status = 'awaiting_approval'
       AND NEW.rejected_at IS NOT NULL
       AND NEW.rejected_at IS DISTINCT FROM OLD.rejected_at THEN
        RETURN NEW;
    END IF;

    -- Prevent going backwards in workflow (except cancellation)
    IF NEW.status = 'draft' AND OLD.status != 'draft' THEN
        RAISE EXCEPTION 'Cannot return PO to draft status';
    END IF;

    RETURN NEW;
END;
$$;

-- rpc_submit_po_for_approval clears the rejected_* stamps when a resubmit routes
-- back to awaiting_approval, but NOT on the within-limits branch that
-- auto-approves. A rejected PO whose buyer fixes it and resubmits under the
-- limit would keep a stale rejected_at, so item 06's Denied tab
-- (rejected_at IS NOT NULL) would still show it AND the Approved tab would too.
-- Clear the rejection on the auto-approve branch too so the denial self-heals
-- exactly like the routed path already does. (Only the approve UPDATE changes;
-- the rest of the function is unchanged.)
CREATE OR REPLACE FUNCTION supply_chain.rpc_submit_po_for_approval(p_po_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'supply_chain', 'inventory', 'public'
AS $function$
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
        rejected_reason = NULL, rejected_at = NULL, rejected_by_user_id = NULL,
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
$function$;
