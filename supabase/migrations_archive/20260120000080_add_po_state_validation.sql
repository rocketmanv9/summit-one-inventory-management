-- Migration: Add state transition validation for purchase orders
-- Non-negotiable: Multitenancy, RLS, Idempotency

-- =====================================================
-- 1. PO STATE TRANSITION VALIDATION FUNCTION
-- =====================================================

CREATE OR REPLACE FUNCTION inventory.validate_po_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = inventory, public
AS $$
DECLARE
    v_valid_transitions TEXT[][] := ARRAY[
        ARRAY['draft', 'awaiting_approval'],
        ARRAY['draft', 'cancelled'],
        ARRAY['awaiting_approval', 'approved'],
        ARRAY['awaiting_approval', 'draft'],
        ARRAY['awaiting_approval', 'cancelled'],
        ARRAY['approved', 'placed'],
        ARRAY['approved', 'cancelled'],
        ARRAY['placed', 'acknowledged'],
        ARRAY['placed', 'cancelled'],
        ARRAY['acknowledged', 'partially_received'],
        ARRAY['acknowledged', 'fully_received'],
        ARRAY['acknowledged', 'cancelled'],
        ARRAY['partially_received', 'fully_received'],
        ARRAY['partially_received', 'cancelled'],
        ARRAY['fully_received', 'closed']
    ];
    v_from_status TEXT;
    v_to_status TEXT;
    v_is_valid BOOLEAN := FALSE;
    v_transition TEXT[];
BEGIN
    -- Only validate on UPDATE when status changes
    IF TG_OP = 'UPDATE' AND OLD.status != NEW.status THEN
        v_from_status := OLD.status;
        v_to_status := NEW.status;
        
        -- Check if transition is valid
        FOREACH v_transition SLICE 1 IN ARRAY v_valid_transitions
        LOOP
            IF v_transition[1] = v_from_status AND v_transition[2] = v_to_status THEN
                v_is_valid := TRUE;
                EXIT;
            END IF;
        END LOOP;
        
        -- Block invalid transitions
        IF NOT v_is_valid THEN
            RAISE EXCEPTION 'Invalid PO status transition from % to %. Valid next states from %: [check documentation]',
                v_from_status, 
                v_to_status, 
                v_from_status
            USING ERRCODE = '23514';  -- check_violation
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$;

-- Apply trigger BEFORE status update (after line status trigger)
DROP TRIGGER IF EXISTS validate_po_status_transition_trigger ON inventory.purchase_orders;
CREATE TRIGGER validate_po_status_transition_trigger
    BEFORE UPDATE ON inventory.purchase_orders
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION inventory.validate_po_status_transition();

COMMENT ON FUNCTION inventory.validate_po_status_transition IS 
'Enforces valid state machine transitions for purchase orders. Prevents illegal status jumps.';
