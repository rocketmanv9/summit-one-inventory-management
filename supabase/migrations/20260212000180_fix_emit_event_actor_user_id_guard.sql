-- Guard actor_user_id to avoid FK violations on events_outbox

BEGIN;

CREATE OR REPLACE FUNCTION inventory.emit_stock_movement_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_event_name text;
  v_payload jsonb;
  v_actor_user_id uuid;
BEGIN
  IF NEW.created_by_user_id IS NOT NULL THEN
    SELECT id INTO v_actor_user_id
    FROM auth.users
    WHERE id = NEW.created_by_user_id;
  END IF;

  CASE NEW.movement_type
    WHEN 'received' THEN
      v_event_name := 'stock.replenished';
      v_payload := jsonb_build_object(
        'movement_id', NEW.id,
        'item_id', NEW.catalog_item_id,
        'location_id', NEW.location_id,
        'quantity_delta', NEW.quantity_delta,
        'source_ref_type', NEW.source_ref_type,
        'source_ref_id', NEW.source_ref_id,
        'tenant_id', NEW.tenant_id,
        'occurred_at', NEW.occurred_at
      );
    WHEN 'issued' THEN
      v_event_name := 'stock.issued';
      v_payload := jsonb_build_object(
        'movement_id', NEW.id,
        'item_id', NEW.catalog_item_id,
        'location_id', NEW.location_id,
        'quantity_delta', NEW.quantity_delta,
        'tenant_id', NEW.tenant_id,
        'occurred_at', NEW.occurred_at
      );
    WHEN 'returned' THEN
      v_event_name := 'stock.returned';
      v_payload := jsonb_build_object(
        'movement_id', NEW.id,
        'item_id', NEW.catalog_item_id,
        'location_id', NEW.location_id,
        'quantity_delta', NEW.quantity_delta,
        'tenant_id', NEW.tenant_id,
        'occurred_at', NEW.occurred_at
      );
    WHEN 'transferred_in', 'transferred_out' THEN
      v_event_name := 'stock.transferred';
      v_payload := jsonb_build_object(
        'movement_id', NEW.id,
        'item_id', NEW.catalog_item_id,
        'location_id', NEW.location_id,
        'quantity_delta', NEW.quantity_delta,
        'correlation_id', NEW.correlation_id,
        'tenant_id', NEW.tenant_id,
        'occurred_at', NEW.occurred_at
      );
    ELSE
      v_event_name := 'stock.adjusted';
      v_payload := jsonb_build_object(
        'movement_id', NEW.id,
        'item_id', NEW.catalog_item_id,
        'location_id', NEW.location_id,
        'quantity_delta', NEW.quantity_delta,
        'movement_type', NEW.movement_type,
        'tenant_id', NEW.tenant_id,
        'occurred_at', NEW.occurred_at
      );
  END CASE;

  PERFORM public.emit_event(
    p_type => v_event_name,
    p_payload => v_payload,
    p_tenant_id => NEW.tenant_id,
    p_actor_id => v_actor_user_id,
    p_trace_id => NULL,
    p_correlation_id => NEW.correlation_id,
    p_aggregate_id => NEW.id
  );

  RETURN NEW;
END;
$$;

COMMIT;
