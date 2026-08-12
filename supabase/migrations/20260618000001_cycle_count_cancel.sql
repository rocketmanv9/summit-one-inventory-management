-- Cancel / void a cycle count.
--
-- There was no way to abandon a cycle count: the only terminal action in the
-- review UI was "Approve & Post", even for a count where nothing was actually
-- counted. This adds a cancel path that voids the count without touching stock.
--
-- A cancel is only allowed from a non-terminal status (draft / scheduled /
-- in_progress / under_review). Approved/posted/closed counts have already
-- written stock movements and must not be cancelled here. The status CHECK
-- constraint already permits 'cancelled', so no DDL on the table is needed.

CREATE OR REPLACE FUNCTION inventory.rpc_inv_cycle_count_cancel(
    p_tenant_id uuid,
    p_cycle_count_id uuid,
    p_reason text DEFAULT NULL::text,
    p_cancelled_by_user_id uuid DEFAULT NULL::uuid,
    p_last_event_id text DEFAULT NULL::text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'inventory', 'supply_chain', 'public'
AS $function$
DECLARE
    v_count RECORD;
BEGIN
    SELECT * INTO v_count
    FROM inventory.cycle_counts
    WHERE id = p_cycle_count_id AND tenant_id = p_tenant_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cycle count not found';
    END IF;

    -- Idempotent: re-cancelling an already-cancelled count is a no-op success.
    IF v_count.status = 'cancelled' THEN
        RETURN TRUE;
    END IF;

    IF v_count.status NOT IN ('draft', 'scheduled', 'in_progress', 'under_review', 'pending_approval') THEN
        RAISE EXCEPTION 'Cannot cancel a count in status % (only draft / scheduled / in progress / under review can be cancelled)', v_count.status;
    END IF;

    UPDATE inventory.cycle_counts
    SET
        status = 'cancelled',
        notes = CASE
            WHEN p_reason IS NULL OR btrim(p_reason) = '' THEN notes
            ELSE btrim(COALESCE(notes || E'\n', '') || 'Cancelled: ' || p_reason)
        END,
        updated_by = COALESCE(p_cancelled_by_user_id, updated_by),
        updated_at = NOW(),
        last_event_id = COALESCE(p_last_event_id, last_event_id)
    WHERE id = p_cycle_count_id;

    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id,
        p_scope => 'inventory',
        p_event_type => 'cycle_count.cancelled',
        p_aggregate_type => 'cycle_count',
        p_aggregate_id => p_cycle_count_id,
        p_payload => jsonb_build_object(
            'cycle_count_id', p_cycle_count_id,
            'cancelled_by_user_id', p_cancelled_by_user_id,
            'reason', p_reason,
            'previous_status', v_count.status
        )
    );

    RETURN TRUE;
END;
$function$;

GRANT EXECUTE ON FUNCTION inventory.rpc_inv_cycle_count_cancel(uuid, uuid, text, uuid, text)
    TO authenticated, service_role;
