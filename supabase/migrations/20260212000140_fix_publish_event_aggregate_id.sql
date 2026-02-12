-- Guard against NULL aggregate_id when emitting events

BEGIN;

CREATE OR REPLACE FUNCTION inventory.publish_event(
    p_tenant_id uuid,
    p_scope text,
    p_event_type text,
    p_aggregate_type text,
    p_aggregate_id uuid,
    p_payload jsonb DEFAULT '{}'::jsonb,
    p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_event_id uuid;
BEGIN
    INSERT INTO inventory.events_outbox (
        tenant_id,
        scope,
        event_type,
        aggregate_type,
        aggregate_id,
        payload,
        metadata,
        status,
        retry_count
    ) VALUES (
        p_tenant_id,
        p_scope,
        p_event_type,
        p_aggregate_type,
        COALESCE(p_aggregate_id, gen_random_uuid()),
        p_payload,
        p_metadata,
        'pending',
        0
    ) RETURNING id INTO v_event_id;

    RETURN v_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION inventory.publish_event(
    p_tenant_id uuid,
    p_scope text,
    p_event_name text,
    p_aggregate_type text,
    p_aggregate_id uuid,
    p_payload jsonb,
    p_event_version integer DEFAULT 1,
    p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_event_id uuid;
BEGIN
    PERFORM public.validate_event_in_catalog(p_event_name, p_event_version);

    INSERT INTO inventory.events_outbox (
        tenant_id,
        scope,
        event_type,
        event_name,
        event_version,
        aggregate_type,
        aggregate_id,
        payload,
        metadata,
        status
    ) VALUES (
        p_tenant_id,
        p_scope,
        p_event_name,
        p_event_name,
        p_event_version,
        p_aggregate_type,
        COALESCE(p_aggregate_id, gen_random_uuid()),
        p_payload,
        p_metadata,
        'pending'
    ) RETURNING id INTO v_event_id;

    RETURN v_event_id;
END;
$$;

COMMIT;
