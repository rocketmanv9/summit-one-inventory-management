-- Migration: Auto-match accounting expenses to POs on receipt
-- Non-negotiable: Multitenancy, RLS, Idempotency

-- =====================================================
-- 1. AUTO-MATCHING FUNCTION
-- =====================================================

CREATE OR REPLACE FUNCTION inventory.auto_match_expenses_on_receipt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = inventory, public
AS $$
DECLARE
    v_po RECORD;
    v_total_received NUMERIC;
    v_matched_count INTEGER := 0;
    v_tolerance_pct NUMERIC := 0.05; -- 5% tolerance
    v_vendor_id UUID;
BEGIN
    -- Get PO details
    SELECT * INTO v_po
    FROM inventory.purchase_orders
    WHERE id = NEW.po_id;
    
    IF NOT FOUND OR v_po.vendor_location_id IS NULL THEN
        RETURN NEW;
    END IF;
    
    -- Get vendor_id from vendor_location
    SELECT vendor_id INTO v_vendor_id
    FROM inventory.locations
    WHERE id = v_po.vendor_location_id;
    
    IF v_vendor_id IS NULL THEN
        RETURN NEW;
    END IF;
    
    -- Calculate total value of received items
    SELECT COALESCE(SUM(rl.qty_received * rl.unit_cost), 0)
    INTO v_total_received
    FROM inventory.receipt_lines rl
    WHERE rl.receipt_id = NEW.id;
    
    -- Skip if no value to match
    IF v_total_received = 0 THEN
        RETURN NEW;
    END IF;
    
    -- Match unmatched expenses for this vendor with similar amounts
    WITH matching_expenses AS (
        SELECT ae.id, ae.amount,
               ABS(ae.amount - v_total_received) AS amount_diff,
               (ABS(ae.amount - v_total_received) / NULLIF(v_total_received, 0)) AS diff_pct
        FROM inventory.accounting_expenses ae
        WHERE ae.tenant_id = NEW.tenant_id
          AND ae.status = 'posted'
          AND ae.vendor_id = v_vendor_id
          AND ae.expense_date >= v_po.order_date - INTERVAL '30 days'
          AND ae.expense_date <= NEW.received_at + INTERVAL '7 days'
          AND (ABS(ae.amount - v_total_received) / NULLIF(v_total_received, 0)) <= v_tolerance_pct
        ORDER BY diff_pct ASC
        LIMIT 1
    )
    UPDATE inventory.accounting_expenses ae
    SET 
        status = 'matched',
        po_id = v_po.id,
        matched_at = NOW(),
        updated_at = NOW()
    FROM matching_expenses me
    WHERE ae.id = me.id;
    
    GET DIAGNOSTICS v_matched_count = ROW_COUNT;
    
    -- Log matching result
    IF v_matched_count > 0 THEN
        RAISE NOTICE 'Auto-matched % expense(s) for PO % (receipt %)', 
            v_matched_count, v_po.po_number, NEW.id;
    END IF;
    
    RETURN NEW;
END;
$$;

-- Apply trigger AFTER receipt insert
DROP TRIGGER IF EXISTS auto_match_expenses_trigger ON inventory.receipts;
CREATE TRIGGER auto_match_expenses_trigger
    AFTER INSERT ON inventory.receipts
    FOR EACH ROW
    EXECUTE FUNCTION inventory.auto_match_expenses_on_receipt();

COMMENT ON FUNCTION inventory.auto_match_expenses_on_receipt IS 
'Automatically matches accounting_expenses to POs when receipts are created. Uses vendor + amount tolerance (±5%).';

-- =====================================================
-- 2. MANUAL MATCH RPC
-- =====================================================

CREATE OR REPLACE FUNCTION inventory.rpc_match_expense_to_po(
    p_tenant_id UUID,
    p_expense_id UUID,
    p_po_id UUID,
    p_user_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = inventory, public
AS $$
DECLARE
    v_expense RECORD;
    v_po RECORD;
BEGIN
    -- Verify expense exists and is matchable
    SELECT * INTO v_expense
    FROM inventory.accounting_expenses
    WHERE id = p_expense_id
      AND tenant_id = p_tenant_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Expense not found';
    END IF;
    
    IF v_expense.status NOT IN ('posted', 'disputed') THEN
        RAISE EXCEPTION 'Expense cannot be matched in status: %', v_expense.status;
    END IF;
    
    -- Verify PO exists
    SELECT * INTO v_po
    FROM inventory.purchase_orders
    WHERE id = p_po_id
      AND tenant_id = p_tenant_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Purchase order not found';
    END IF;
    
    -- Perform match
    UPDATE inventory.accounting_expenses
    SET 
        status = 'matched',
        po_id = p_po_id,
        matched_at = NOW(),
        updated_at = NOW()
    WHERE id = p_expense_id;
    
    -- Publish event
    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id,
        p_scope => 'tenant',
        p_event_type => 'accounting_expense.matched',
        p_aggregate_type => 'accounting_expense',
        p_aggregate_id => p_expense_id,
        p_payload => jsonb_build_object(
            'expense_id', p_expense_id,
            'po_id', p_po_id,
            'amount', v_expense.amount,
            'matched_by_user_id', p_user_id
        ),
        p_metadata => jsonb_build_object(
            'manual_match', true,
            'matched_at', NOW()
        )
    );
    
    RETURN TRUE;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION inventory.rpc_match_expense_to_po TO authenticated;

COMMENT ON FUNCTION inventory.rpc_match_expense_to_po IS 
'Manually match an accounting expense to a purchase order. Validates status and publishes event.';
