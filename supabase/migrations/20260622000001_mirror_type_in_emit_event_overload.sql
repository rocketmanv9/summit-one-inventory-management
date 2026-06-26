-- Mirror event_type -> chassis `type` (and `version`) in the named-arg
-- emit_event overload.
--
-- Background: public.emit_event has two overloads.
--   * emit_event(p_event_type, ...) routes through inventory.publish_event,
--     which sets BOTH the baseline `event_type` AND the chassis `type`/`version`
--     columns on events_outbox.
--   * emit_event(p_type, ...) (the named-arg overload that the tasks_emit_event
--     and notifications_emit_event triggers call) did a DIRECT insert that set
--     only `event_type`, leaving `type` / `version` NULL.
--
-- The active dispatcher (supabase/functions/events-poller) forwards on
-- `event_type`, so NULL `type` is harmless today. But a future chassis-based
-- consumer that keys on `type` would silently miss every task.*/notification.*
-- event. This aligns the two overloads so the outbox row is consumer-agnostic.
--
-- CRITICAL: the INSERT MUST target public.events_outbox explicitly, and the
-- function MUST pin its search_path. There is ALSO an inventory.events_outbox
-- table that has NEITHER a `type` NOR a `version` column. This overload is
-- called by stock/receipt triggers (emit_stock_movement_event, etc.) that run
-- under a search_path of 'supply_chain, inventory, public'. With an unqualified
-- `events_outbox`, the name resolved to inventory.events_outbox and every stock
-- write (receiving, adjust, issue, transfer) failed with:
--   column "type" of relation "events_outbox" does not exist
-- The original task/notification smoke test ran under a public-first path, so it
-- never hit inventory.events_outbox and masked the regression. Qualifying the
-- table (matching what inventory.publish_event already does) is the fix.

BEGIN;

CREATE OR REPLACE FUNCTION public.emit_event(
  p_type text,
  p_payload jsonb,
  p_tenant_id uuid DEFAULT NULL::uuid,
  p_actor_id uuid DEFAULT NULL::uuid,
  p_trace_id uuid DEFAULT NULL::uuid,
  p_correlation_id uuid DEFAULT NULL::uuid,
  p_aggregate_id uuid DEFAULT NULL::uuid
)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID;
  v_version INTEGER;
  v_agg_type TEXT;
BEGIN
  -- Lookup version and aggregate type
  SELECT event_version, aggregate_type INTO v_version, v_agg_type
  FROM event_catalog
  WHERE event_key = p_type;

  -- Handle unregistered events gracefully (Default to v1 / system)
  IF v_version IS NULL THEN
    v_version := 1;
    v_agg_type := 'system';
  END IF;

  INSERT INTO public.events_outbox (
    event_type, event_version, payload,
    tenant_id, actor_user_id,
    trace_id, correlation_id,
    aggregate_type, aggregate_id,
    -- Chassis columns: mirror so consumers keyed on `type`/`version` see these
    -- events too (publish_event already does this for the other overload).
    type, version
  ) VALUES (
    p_type, v_version, p_payload,
    p_tenant_id, p_actor_id,
    COALESCE(p_trace_id, gen_random_uuid()), p_correlation_id,
    v_agg_type, p_aggregate_id,
    p_type, v_version
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

COMMIT;
