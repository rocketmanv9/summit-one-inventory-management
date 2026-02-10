-- Fix rpc_create_receipt_v2 to support both JWT tenant_id paths

CREATE OR REPLACE FUNCTION supply_chain.rpc_create_receipt_v2(
  p_receipt_number TEXT DEFAULT NULL,
  p_location_id UUID DEFAULT NULL,
  p_lines JSONB DEFAULT NULL,
  p_po_id UUID DEFAULT NULL,
  p_vendor_id UUID DEFAULT NULL,
  p_received_at TIMESTAMPTZ DEFAULT now(),
  p_notes TEXT DEFAULT NULL,
  p_packing_slip_no TEXT DEFAULT NULL,
  p_vendor_invoice_no TEXT DEFAULT NULL,
  p_source_type TEXT DEFAULT 'delivery',
  p_status TEXT DEFAULT 'confirmed',
  p_auto_post BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = supply_chain, inventory, public
AS $$
DECLARE
  v_tenant_id UUID;
  v_user_id UUID;
  v_receipt_id UUID;
  v_receipt_number TEXT;
  v_line JSONB;
  v_line_number INT := 0;
  v_post_result JSONB;
  v_result JSONB;
  v_event_id TEXT;
  v_next_seq INT;
BEGIN
  -- Support both JWT tenant_id paths (app_metadata or root)
  v_tenant_id := COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::UUID,
    (auth.jwt() ->> 'tenant_id')::UUID
  );
  
  -- Support both JWT user_id paths
  v_user_id := COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'user_id')::UUID,
    (auth.jwt() ->> 'user_id')::UUID,
    (auth.jwt() ->> 'sub')::UUID
  );
  
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required - no tenant_id in JWT';
  END IF;
  
  IF p_location_id IS NULL THEN
    RAISE EXCEPTION 'location_id is required';
  END IF;
  
  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'At least one line item is required';
  END IF;
  
  -- Auto-generate receipt number if not provided
  IF p_receipt_number IS NULL OR p_receipt_number = '' THEN
    -- Get next sequence number for this tenant
    SELECT COALESCE(MAX(CAST(SUBSTRING(receipt_number FROM '[0-9]+$') AS INTEGER)), 0) + 1
    INTO v_next_seq
    FROM supply_chain.receipts
    WHERE tenant_id = v_tenant_id
      AND receipt_number ~ '^RCV-[0-9]+$';
    
    v_receipt_number := 'RCV-' || LPAD(v_next_seq::TEXT, 6, '0');
  ELSE
    v_receipt_number := p_receipt_number;
  END IF;
  
  -- Validate status
  IF p_status NOT IN ('draft', 'confirmed', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid status: %. Must be draft, confirmed, or cancelled.', p_status;
  END IF;
  
  -- Validate source_type
  IF p_source_type NOT IN ('delivery', 'pickup', 'transfer', 'return') THEN
    RAISE EXCEPTION 'Invalid source_type: %. Must be delivery, pickup, transfer, or return.', p_source_type;
  END IF;
  
  -- Generate idempotency event_id for receipt
  v_event_id := 'receipt-create-' || v_receipt_number || '-' || extract(epoch from now())::TEXT;
  
  -- Insert receipt header
  INSERT INTO supply_chain.receipts (
    tenant_id,
    receipt_number,
    location_id,
    po_id,
    vendor_id,
    received_at,
    notes,
    packing_slip_no,
    vendor_invoice_no,
    source_type,
    status,
    received_by_user_id,
    created_by,
    last_event_id
  ) VALUES (
    v_tenant_id,
    v_receipt_number,
    p_location_id,
    p_po_id,
    p_vendor_id,  -- Will be auto-populated from PO if NULL (via trigger)
    p_received_at,
    p_notes,
    p_packing_slip_no,
    p_vendor_invoice_no,
    p_source_type,
    p_status,
    v_user_id,
    v_user_id,
    v_event_id
  )
  ON CONFLICT (tenant_id, last_event_id) DO NOTHING
  RETURNING id INTO v_receipt_id;
  
  -- Check for duplicate (idempotency)
  IF v_receipt_id IS NULL THEN
    -- Receipt already exists with this event_id
    SELECT id INTO v_receipt_id
    FROM supply_chain.receipts
    WHERE tenant_id = v_tenant_id AND last_event_id = v_event_id;
    
    RAISE NOTICE 'Receipt with event_id % already exists (idempotent). Returning existing receipt %', v_event_id, v_receipt_id;
    
    RETURN jsonb_build_object(
      'success', true,
      'receipt_id', v_receipt_id,
      'receipt_number', v_receipt_number,
      'message', 'Receipt already exists (idempotent)',
      'posted_to_inventory', false
    );
  END IF;
  
  -- Insert receipt lines
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_line_number := v_line_number + 1;
    
    -- Generate line-level event_id for idempotency
    v_event_id := 'receipt-' || v_receipt_id::TEXT || '-line-' || v_line_number::TEXT || '-' || extract(epoch from now())::TEXT;
    
    INSERT INTO supply_chain.receipt_lines (
      tenant_id,
      receipt_id,
      line_number,
      catalog_item_id,
      qty_received,
      po_line_id,
      condition_status,
      destination_location_id,
      unit_cost_actual,
      uom,
      notes,
      created_by,
      last_event_id
    ) VALUES (
      v_tenant_id,
      v_receipt_id,
      v_line_number,
      (v_line->>'catalog_item_id')::UUID,
      (v_line->>'qty_received')::NUMERIC,
      (v_line->>'po_line_id')::UUID,
      COALESCE(v_line->>'condition_status', 'accepted'),
      (v_line->>'destination_location_id')::UUID,  -- Will be auto-populated from receipt if NULL (via trigger)
      (v_line->>'unit_cost_actual')::NUMERIC,
      v_line->>'uom',
      v_line->>'notes',
      v_user_id,
      v_event_id
    )
    ON CONFLICT (tenant_id, last_event_id) DO NOTHING;
  END LOOP;
  
  -- Auto-post to inventory if requested and status is confirmed
  IF p_auto_post AND p_status = 'confirmed' THEN
    BEGIN
      v_post_result := supply_chain.rpc_post_receipt_to_inventory(v_receipt_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed to auto-post receipt % to inventory: %', v_receipt_id, SQLERRM;
      v_post_result := jsonb_build_object(
        'success', false,
        'error', SQLERRM
      );
    END;
  ELSE
    v_post_result := jsonb_build_object('success', false, 'message', 'Auto-post not requested or status is not confirmed');
  END IF;
  
  -- Build result
  v_result := jsonb_build_object(
    'success', true,
    'receipt_id', v_receipt_id,
    'receipt_number', v_receipt_number,
    'lines_created', v_line_number,
    'auto_post_result', v_post_result
  );
  
  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION supply_chain.rpc_create_receipt_v2 TO authenticated;
