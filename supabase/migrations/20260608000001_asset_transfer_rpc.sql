-- ============================================================================
-- Asset transfer RPC
-- Moves a single asset to a different location, updating the asset row and the
-- asset_state read model, recording an immutable `moved` entry in asset_events
-- (so it shows in the asset's Activity Log), and publishing an outbox event.
-- Idempotent via p_last_event_id (asset_events has a unique (tenant_id,
-- last_event_id) guard). Mirrors the pattern of rpc_inv_asset_assign/return.
-- ============================================================================

CREATE OR REPLACE FUNCTION "inventory"."rpc_inv_asset_transfer"(
    "p_tenant_id" "uuid",
    "p_asset_id" "uuid",
    "p_to_location_id" "uuid",
    "p_actor_user_id" "uuid" DEFAULT NULL::"uuid",
    "p_notes" "text" DEFAULT NULL::"text",
    "p_last_event_id" "text" DEFAULT NULL::"text"
) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'inventory', 'public'
    AS $$
DECLARE
    v_asset RECORD;
    v_from_location_id uuid;
    v_from_name text;
    v_to_name text;
    v_existing uuid;
BEGIN
    IF p_tenant_id IS NULL OR p_asset_id IS NULL OR p_to_location_id IS NULL THEN
        RAISE EXCEPTION 'tenant_id, asset_id and to_location_id are required';
    END IF;
    IF p_last_event_id IS NULL THEN
        RAISE EXCEPTION 'p_last_event_id is required';
    END IF;

    -- Idempotent replay: if this event was already recorded, succeed silently.
    SELECT id INTO v_existing
    FROM inventory.asset_events
    WHERE tenant_id = p_tenant_id AND last_event_id = p_last_event_id;
    IF v_existing IS NOT NULL THEN
        RETURN TRUE;
    END IF;

    -- Asset must belong to the tenant.
    SELECT * INTO v_asset
    FROM inventory.assets
    WHERE id = p_asset_id AND tenant_id = p_tenant_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Asset not found';
    END IF;

    v_from_location_id := v_asset.location_id;

    -- Destination must be a location of the same tenant.
    SELECT name INTO v_to_name
    FROM inventory.locations
    WHERE id = p_to_location_id AND tenant_id = p_tenant_id;
    IF v_to_name IS NULL THEN
        RAISE EXCEPTION 'Destination location not found';
    END IF;

    IF v_from_location_id IS NOT DISTINCT FROM p_to_location_id THEN
        RAISE EXCEPTION 'Asset is already at that location';
    END IF;

    IF v_from_location_id IS NOT NULL THEN
        SELECT name INTO v_from_name FROM inventory.locations WHERE id = v_from_location_id;
    END IF;

    -- Move the asset.
    UPDATE inventory.assets
    SET location_id = p_to_location_id, updated_at = NOW()
    WHERE id = p_asset_id;

    -- Keep the read model in sync (preserve status; only the location moves).
    INSERT INTO inventory.asset_state (
        id, tenant_id, asset_id, current_status, current_location_id, last_movement_at
    ) VALUES (
        p_asset_id, p_tenant_id, p_asset_id, COALESCE(v_asset.status, 'available'),
        p_to_location_id, NOW()
    )
    ON CONFLICT (tenant_id, asset_id) DO UPDATE
    SET current_location_id = p_to_location_id,
        last_movement_at = NOW(),
        updated_at = NOW();

    -- Immutable audit entry (drives the asset Activity Log).
    PERFORM inventory.insert_asset_event(
        p_tenant_id => p_tenant_id,
        p_event_type => 'moved',
        p_occurred_at => NOW(),
        p_asset_id => p_asset_id,
        p_actor_user_id => p_actor_user_id,
        p_source_system => 'inventory',
        p_last_event_id => p_last_event_id,
        p_payload => jsonb_build_object(
            'from_location_id', v_from_location_id,
            'from_location', v_from_name,
            'to_location_id', p_to_location_id,
            'to_location', v_to_name,
            'notes', p_notes
        )
    );

    -- Outbox event for downstream consumers.
    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id,
        p_scope => 'asset',
        p_event_type => 'asset.moved',
        p_aggregate_type => 'asset',
        p_aggregate_id => p_asset_id,
        p_payload => jsonb_build_object(
            'asset_id', p_asset_id,
            'asset_tag', v_asset.asset_tag,
            'from_location_id', v_from_location_id,
            'to_location_id', p_to_location_id
        )
    );

    RETURN TRUE;
END;
$$;

ALTER FUNCTION "inventory"."rpc_inv_asset_transfer"(
    "uuid", "uuid", "uuid", "uuid", "text", "text"
) OWNER TO "postgres";

GRANT ALL ON FUNCTION "inventory"."rpc_inv_asset_transfer"(
    "uuid", "uuid", "uuid", "uuid", "text", "text"
) TO "anon";
GRANT ALL ON FUNCTION "inventory"."rpc_inv_asset_transfer"(
    "uuid", "uuid", "uuid", "uuid", "text", "text"
) TO "authenticated";
GRANT ALL ON FUNCTION "inventory"."rpc_inv_asset_transfer"(
    "uuid", "uuid", "uuid", "uuid", "text", "text"
) TO "service_role";

COMMENT ON FUNCTION "inventory"."rpc_inv_asset_transfer"(
    "uuid", "uuid", "uuid", "uuid", "text", "text"
) IS 'Moves an asset to a new location, syncs asset_state, logs a moved asset_event, and publishes asset.moved.';
