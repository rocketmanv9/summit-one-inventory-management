-- Add a 3-arg shim to disambiguate emit_event() calls

BEGIN;

CREATE OR REPLACE FUNCTION public.emit_event(
  p_type text,
  p_payload jsonb,
  p_tenant_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event_id uuid;
BEGIN
  v_event_id := public.emit_event(
    p_type => p_type,
    p_payload => p_payload,
    p_tenant_id => p_tenant_id,
    p_actor_id => NULL,
    p_trace_id => NULL,
    p_correlation_id => NULL,
    p_aggregate_id => NULL
  );

  RETURN v_event_id;
END;
$$;

COMMIT;
