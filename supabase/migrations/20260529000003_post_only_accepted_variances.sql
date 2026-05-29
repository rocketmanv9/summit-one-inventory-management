-- post_cycle_count_adjustments posted EVERY line with a non-zero variance,
-- ignoring the reviewer's decision. That meant a line marked 'rejected' or
-- 'investigating' (or still 'pending') was still written to stock — directly
-- contradicting the approve dialog's promise to "preserve rejected counts for
-- audit". Only lines explicitly 'accepted' should produce a stock movement.
--
-- Lines with a variance but decision_status <> 'accepted' are left untouched
-- (no movement, posted_at stays NULL) so they remain visible/auditable.

CREATE OR REPLACE FUNCTION inventory.post_cycle_count_adjustments(
    p_cycle_count_id uuid,
    p_tenant_id uuid,
    p_posted_by_user_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    v_count_status TEXT;
    v_posted_at TIMESTAMPTZ;
    v_correlation_id UUID;
    v_adjustments_created INTEGER := 0;
    v_lines_processed INTEGER := 0;
    v_result JSONB;
    v_line RECORD;
BEGIN
    -- Check if already posted (idempotency)
    SELECT status, posted_at
    INTO v_count_status, v_posted_at
    FROM inventory.cycle_counts
    WHERE id = p_cycle_count_id AND tenant_id = p_tenant_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cycle count % not found', p_cycle_count_id;
    END IF;

    IF v_posted_at IS NOT NULL THEN
        RAISE NOTICE 'Cycle count % already posted at %', p_cycle_count_id, v_posted_at;
        RETURN jsonb_build_object(
            'success', TRUE,
            'message', 'Already posted',
            'posted_at', v_posted_at,
            'adjustments_created', 0
        );
    END IF;

    -- Verify status allows posting
    IF v_count_status NOT IN ('approved', 'under_review') THEN
        RAISE EXCEPTION 'Cannot post cycle count in status: %', v_count_status;
    END IF;

    -- Generate correlation ID for this posting batch
    v_correlation_id := gen_random_uuid();
    v_posted_at := NOW();

    -- Process SKU lines (fungible items). Only post variances the reviewer
    -- ACCEPTED — rejected/investigating/pending lines are preserved untouched.
    FOR v_line IN
        SELECT
            ccl.id as line_id,
            ccl.catalog_item_id,
            ccl.location_id,
            ccl.variance
        FROM inventory.cycle_count_lines ccl
        WHERE ccl.cycle_count_id = p_cycle_count_id
            AND ccl.tenant_id = p_tenant_id
            AND ccl.variance IS NOT NULL
            AND ccl.variance <> 0
            AND ccl.posted_at IS NULL
            AND ccl.decision_status = 'accepted'
    LOOP
        -- Create stock movement for adjustment
        INSERT INTO inventory.stock_movements (
            tenant_id,
            catalog_item_id,
            location_id,
            quantity_delta,
            movement_type,
            source_ref_type,
            source_ref_id,
            reason,
            correlation_id,
            occurred_at,
            created_by_user_id,
            last_event_id,
            posting_status
        ) VALUES (
            p_tenant_id,
            v_line.catalog_item_id,
            v_line.location_id,
            v_line.variance,
            'adjusted',
            'cycle_count',
            p_cycle_count_id,
            'Cycle count adjustment',
            v_correlation_id,
            v_posted_at,
            p_posted_by_user_id,
            'cc_adj_' || p_cycle_count_id::TEXT || '_line_' || v_line.line_id::TEXT,
            'posted'
        );

        -- Mark line as posted
        UPDATE inventory.cycle_count_lines
        SET posted_at = v_posted_at
        WHERE id = v_line.line_id;

        v_adjustments_created := v_adjustments_created + 1;
        v_lines_processed := v_lines_processed + 1;
    END LOOP;

    -- TODO: Process asset lines (serialized items) - future enhancement

    -- Mark cycle count as posted
    UPDATE inventory.cycle_counts
    SET
        status = 'posted',
        posted_at = v_posted_at
    WHERE id = p_cycle_count_id AND tenant_id = p_tenant_id;

    -- Emit event
    PERFORM public.emit_event(
        p_event_name := 'inventory.cycle_count.posted',
        p_tenant_id := p_tenant_id,
        p_scope := 'tenant',
        p_aggregate_type := 'cycle_count',
        p_aggregate_id := p_cycle_count_id,
        p_payload := jsonb_build_object(
            'cycle_count_id', p_cycle_count_id,
            'posted_at', v_posted_at,
            'adjustments_created', v_adjustments_created,
            'correlation_id', v_correlation_id,
            'posted_by_user_id', p_posted_by_user_id
        ),
        p_actor_user_id := p_posted_by_user_id
    );

    -- Build result
    v_result := jsonb_build_object(
        'success', TRUE,
        'cycle_count_id', p_cycle_count_id,
        'posted_at', v_posted_at,
        'adjustments_created', v_adjustments_created,
        'lines_processed', v_lines_processed,
        'correlation_id', v_correlation_id
    );

    RAISE NOTICE 'Posted cycle count %: % adjustments created', p_cycle_count_id, v_adjustments_created;

    RETURN v_result;
END;
$function$;
