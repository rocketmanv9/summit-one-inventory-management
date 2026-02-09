-- Fix adjust inventory movement_type to match stock_movements check constraint
CREATE OR REPLACE FUNCTION inventory.rpc_adjust_inventory(
  p_location_id uuid,
  p_catalog_item_id uuid,
  p_new_qty numeric,
  p_reason text,
  p_notes text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO inventory, public
AS $$
DECLARE
  v_tenant_id uuid;
  v_user_id uuid;
  v_current_qty numeric;
  v_delta numeric;
  v_event_id text;
BEGIN
  v_tenant_id := current_tenant_id();
  v_user_id := (auth.jwt() ->> 'user_id')::uuid;
  IF v_user_id IS NULL THEN
    v_user_id := auth.uid();
  END IF;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'Reason required for inventory adjustment';
  END IF;

  -- Get current quantity
  SELECT COALESCE(qty_on_hand, 0)
  INTO v_current_qty
  FROM inventory.stock_balances
  WHERE tenant_id = v_tenant_id
    AND catalog_item_id = p_catalog_item_id
    AND location_id = p_location_id;

  IF v_current_qty IS NULL THEN
    v_current_qty := 0;
  END IF;

  v_delta := p_new_qty - v_current_qty;

  IF v_delta = 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'No adjustment needed (quantity unchanged)',
      'current_qty', v_current_qty,
      'new_qty', p_new_qty,
      'delta', 0
    );
  END IF;

  v_event_id := 'adjust-' || gen_random_uuid()::text || '-' || extract(epoch from now())::text;

  -- Insert inventory event (payload-only model)
  INSERT INTO inventory.inventory_events (
    tenant_id,
    event_type,
    occurred_at,
    actor_user_id,
    last_event_id,
    payload
  ) VALUES (
    v_tenant_id,
    'adjust',
    now(),
    v_user_id,
    v_event_id,
    jsonb_build_object(
      'catalog_item_id', p_catalog_item_id,
      'location_id', p_location_id,
      'reason', p_reason,
      'old_qty', v_current_qty,
      'new_qty', p_new_qty,
      'notes', p_notes
    )
  );

  -- Insert stock movement
  INSERT INTO inventory.stock_movements (
    tenant_id,
    catalog_item_id,
    location_id,
    quantity_delta,
    movement_type,
    reason,
    notes,
    occurred_at,
    created_by_user_id,
    last_event_id
  ) VALUES (
    v_tenant_id,
    p_catalog_item_id,
    p_location_id,
    v_delta,
    'adjusted',
    p_reason,
    p_notes,
    now(),
    v_user_id,
    v_event_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'current_qty', v_current_qty,
    'new_qty', p_new_qty,
    'delta', v_delta
  );
END;
$$;
