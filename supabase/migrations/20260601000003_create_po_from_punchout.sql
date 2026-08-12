-- Supports Amazon-initiated punchout: a cart returned from Amazon for which the
-- app never started a session (no buyer_cookie match). The punchout-return
-- webhook is unauthenticated (browser form POST), so it can't use
-- rpc_create_purchase_order (that one derives tenant from auth.jwt() and throws
-- without a JWT). This variant takes an explicit tenant_id and creates a DRAFT PO
-- the user can review/approve in the app. SECURITY DEFINER; callers are trusted
-- server code (service role) that has already resolved the tenant from the POOM.

CREATE OR REPLACE FUNCTION supply_chain.rpc_create_po_from_punchout(
  p_tenant_id uuid,
  p_vendor_id uuid,
  p_delivery_location_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_lines jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'supply_chain', 'inventory', 'public'
AS $function$
DECLARE
  v_po_id uuid;
  v_po_number text;
  v_event_id uuid;
  v_vendor_name text;
  v_vendor_code text;
  v_line jsonb;
  v_line_number int := 0;
BEGIN
  IF p_tenant_id IS NULL THEN RAISE EXCEPTION 'p_tenant_id required'; END IF;
  IF p_vendor_id IS NULL THEN RAISE EXCEPTION 'p_vendor_id required'; END IF;

  v_po_number := supply_chain.generate_po_number(p_tenant_id);
  v_event_id := gen_random_uuid();

  SELECT name, code INTO v_vendor_name, v_vendor_code
  FROM supply_chain.vendors WHERE id = p_vendor_id AND tenant_id = p_tenant_id;

  INSERT INTO supply_chain.purchase_orders (
    tenant_id, po_number, vendor_id, vendor_name_snapshot, vendor_code_snapshot,
    delivery_method, cost_context, delivery_location_id, notes, attachments,
    status, order_date, last_event_id
  ) VALUES (
    p_tenant_id, v_po_number, p_vendor_id, v_vendor_name, v_vendor_code,
    'ship', 'overhead', p_delivery_location_id, p_notes, '[]'::jsonb,
    'draft', CURRENT_DATE, v_event_id
  ) RETURNING id INTO v_po_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_line_number := v_line_number + 1;
    INSERT INTO supply_chain.purchase_order_lines (
      tenant_id, po_id, line_number, catalog_item_id, item_description,
      qty_ordered, unit_cost, price_basis, status, line_notes, last_event_id
    ) VALUES (
      p_tenant_id, v_po_id, v_line_number,
      NULLIF(v_line->>'catalog_item_id','')::uuid,
      v_line->>'item_description',
      COALESCE((v_line->>'qty_ordered')::numeric, 1),
      NULLIF(v_line->>'unit_cost','')::numeric,
      'fixed', 'pending', v_line->>'line_notes', v_event_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'po_id', v_po_id,
    'po_number', v_po_number,
    'line_count', v_line_number,
    'status', 'draft'
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION supply_chain.rpc_create_po_from_punchout(uuid, uuid, uuid, text, jsonb)
  TO service_role;
