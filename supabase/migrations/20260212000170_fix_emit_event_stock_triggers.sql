-- Fix stock movement/threshold triggers to use new emit_event signature
-- Remove 3-arg shim to avoid ambiguity

BEGIN;

DROP FUNCTION IF EXISTS public.emit_event(text, jsonb, uuid);

CREATE OR REPLACE FUNCTION inventory.emit_stock_movement_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_event_name text;
  v_payload jsonb;
BEGIN
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
    p_actor_id => NEW.created_by_user_id,
    p_trace_id => NULL,
    p_correlation_id => NEW.correlation_id,
    p_aggregate_id => NEW.id
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION inventory.emit_stock_threshold_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_par_level record;
  v_payload jsonb;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.qty_on_hand < OLD.qty_on_hand THEN
    SELECT * INTO v_par_level
    FROM inventory.item_location_par_levels
    WHERE catalog_item_id = NEW.catalog_item_id
      AND location_id = NEW.location_id
      AND tenant_id = NEW.tenant_id;

    IF FOUND THEN
      IF OLD.qty_on_hand >= v_par_level.reorder_point AND NEW.qty_on_hand < v_par_level.reorder_point THEN
        v_payload := jsonb_build_object(
          'item_id', NEW.catalog_item_id,
          'location_id', NEW.location_id,
          'current_qty', NEW.qty_on_hand,
          'reorder_point', v_par_level.reorder_point,
          'reorder_qty', v_par_level.reorder_qty,
          'tenant_id', NEW.tenant_id,
          'detected_at', NOW()
        );

        PERFORM public.emit_event(
          p_type => 'stock.low_threshold_reached',
          p_payload => v_payload,
          p_tenant_id => NEW.tenant_id,
          p_actor_id => NULL,
          p_trace_id => NULL,
          p_correlation_id => NULL,
          p_aggregate_id => NEW.id
        );
      END IF;

      IF OLD.qty_on_hand > 0 AND NEW.qty_on_hand <= 0 THEN
        v_payload := jsonb_build_object(
          'item_id', NEW.catalog_item_id,
          'location_id', NEW.location_id,
          'previous_qty', OLD.qty_on_hand,
          'tenant_id', NEW.tenant_id,
          'occurred_at', NOW()
        );

        PERFORM public.emit_event(
          p_type => 'stock.out_of_stock',
          p_payload => v_payload,
          p_tenant_id => NEW.tenant_id,
          p_actor_id => NULL,
          p_trace_id => NULL,
          p_correlation_id => NULL,
          p_aggregate_id => NEW.id
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
