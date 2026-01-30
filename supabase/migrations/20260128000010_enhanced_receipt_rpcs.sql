-- =====================================================================
-- Enhanced Receipt Creation and Posting RPCs
-- Date: 2026-01-28
-- Description: Updated RPCs to support new receipt workflow features
-- =====================================================================

-- =====================================================================
-- RPC: Enhanced Receipt Creation (v2)
-- Supports status, vendor_id, condition tracking, etc.
-- =====================================================================

CREATE OR REPLACE FUNCTION supply_chain.rpc_create_receipt_v2(
  p_receipt_number TEXT,
  p_location_id UUID,
  p_lines JSONB,
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
  v_line JSONB;
  v_line_number INT := 0;
  v_post_result JSONB;
  v_result JSONB;
  v_event_id TEXT;
BEGIN
  -- Get tenant and user from JWT
  v_tenant_id := (auth.jwt() ->> 'tenant_id')::UUID;
  v_user_id := (auth.jwt() ->> 'user_id')::UUID;
  
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
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
  v_event_id := 'receipt-create-' || p_receipt_number || '-' || extract(epoch from now())::TEXT;
  
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
    p_receipt_number,
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
      'receipt_number', p_receipt_number,
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
  
  -- Auto-post to inventory if requested AND status is 'confirmed'
  IF p_auto_post AND p_status = 'confirmed' THEN
    v_post_result := supply_chain.rpc_post_receipt_to_inventory_v2(
      v_receipt_id,
      v_user_id
    );
    
    v_result := jsonb_build_object(
      'success', true,
      'receipt_id', v_receipt_id,
      'receipt_number', p_receipt_number,
      'line_count', v_line_number,
      'status', p_status,
      'posted_to_inventory', true,
      'post_result', v_post_result
    );
  ELSE
    v_result := jsonb_build_object(
      'success', true,
      'receipt_id', v_receipt_id,
      'receipt_number', p_receipt_number,
      'line_count', v_line_number,
      'status', p_status,
      'posted_to_inventory', false,
      'message', CASE 
        WHEN p_status = 'draft' THEN 'Receipt saved as draft. Call confirm endpoint to post to inventory.'
        ELSE 'Receipt created but not posted to inventory'
      END
    );
  END IF;
  
  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION supply_chain.rpc_create_receipt_v2 IS 
  'Enhanced receipt creation with support for status, vendor_id, condition tracking, and more.
  If status=confirmed and auto_post=true, will automatically post to inventory.
  If status=draft, receipt is saved but not posted (allows for review/approval).';

GRANT EXECUTE ON FUNCTION supply_chain.rpc_create_receipt_v2 TO authenticated;

-- =====================================================================
-- RPC: Enhanced Receipt Posting to Inventory (v2)
-- Handles condition_status, destination_location_id, etc.
-- =====================================================================

CREATE OR REPLACE FUNCTION supply_chain.rpc_post_receipt_to_inventory_v2(
  p_receipt_id UUID,
  p_actor_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = supply_chain, inventory, public
AS $$
DECLARE
  v_tenant_id UUID;
  v_receipt supply_chain.receipts%ROWTYPE;
  v_line supply_chain.receipt_lines%ROWTYPE;
  v_catalog_item inventory.catalog_items%ROWTYPE;
  v_location inventory.locations%ROWTYPE;
  v_event_id TEXT;
  v_movement_id UUID;
  v_posted_count INT := 0;
  v_skipped_count INT := 0;
  v_rejected_count INT := 0;
  v_damaged_count INT := 0;
  v_result JSONB;
  v_movement_type TEXT;
BEGIN
  -- Get tenant from JWT
  v_tenant_id := (auth.jwt() ->> 'tenant_id')::UUID;
  
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'No tenant_id in JWT. Authentication required.';
  END IF;
  
  -- Fetch receipt header
  SELECT * INTO v_receipt
  FROM supply_chain.receipts
  WHERE id = p_receipt_id
    AND tenant_id = v_tenant_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receipt % not found for tenant %', p_receipt_id, v_tenant_id;
  END IF;
  
  -- Check status
  IF v_receipt.status = 'cancelled' THEN
    RAISE EXCEPTION 'Cannot post cancelled receipt %', p_receipt_id;
  END IF;
  
  -- Check if already posted
  IF v_receipt.status = 'confirmed' AND EXISTS (
    SELECT 1 FROM inventory.stock_movements
    WHERE tenant_id = v_tenant_id
      AND source_ref_type = 'receipt'
      AND source_ref_id = p_receipt_id
  ) THEN
    RAISE NOTICE 'Receipt % already posted to inventory (idempotent). Skipping.', p_receipt_id;
    
    RETURN jsonb_build_object(
      'success', true,
      'receipt_id', p_receipt_id,
      'posted_lines', 0,
      'message', 'Already posted (idempotent)'
    );
  END IF;
  
  -- Validate location exists in inventory
  SELECT * INTO v_location
  FROM inventory.locations
  WHERE id = v_receipt.location_id
    AND tenant_id = v_tenant_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Location % not found in inventory schema', v_receipt.location_id;
  END IF;
  
  -- Process each receipt line
  FOR v_line IN
    SELECT *
    FROM supply_chain.receipt_lines
    WHERE receipt_id = p_receipt_id
      AND tenant_id = v_tenant_id
    ORDER BY line_number
  LOOP
    -- Validate catalog item exists
    SELECT * INTO v_catalog_item
    FROM inventory.catalog_items
    WHERE id = v_line.catalog_item_id
      AND tenant_id = v_tenant_id;
    
    IF NOT FOUND THEN
      RAISE WARNING 'Catalog item % not found. Skipping line %.', v_line.catalog_item_id, v_line.line_number;
      v_skipped_count := v_skipped_count + 1;
      CONTINUE;
    END IF;
    
    -- Generate unique event_id for this line
    v_event_id := 'receipt-' || p_receipt_id::TEXT || '-line-' || v_line.line_number::TEXT || '-post-' || extract(epoch from now())::TEXT;
    
    -- Handle based on condition_status
    CASE v_line.condition_status
      WHEN 'rejected' THEN
        -- Rejected items: Log event but DO NOT add to inventory
        INSERT INTO inventory.inventory_events (
          tenant_id,
          catalog_item_id,
          location_id,
          event_type,
          quantity_delta,
          payload,
          correlation_id,
          occurred_at,
          actor_user_id,
          last_event_id
        ) VALUES (
          v_tenant_id,
          v_line.catalog_item_id,
          COALESCE(v_line.destination_location_id, v_receipt.location_id),
          'rejected',
          0,  -- Zero delta (not added to inventory)
          jsonb_build_object(
            'receipt_id', p_receipt_id,
            'receipt_number', v_receipt.receipt_number,
            'receipt_line_id', v_line.id,
            'line_number', v_line.line_number,
            'qty_received', v_line.qty_received,
            'condition', 'rejected',
            'reason', 'Items rejected during receiving'
          ),
          p_receipt_id,
          v_receipt.received_at,
          COALESCE(p_actor_user_id, v_receipt.created_by_user_id),
          v_event_id
        )
        ON CONFLICT (tenant_id, last_event_id) DO NOTHING;
        
        v_rejected_count := v_rejected_count + 1;
        RAISE NOTICE '⚠ Rejected line %: % x % (not added to inventory)', 
          v_line.line_number, v_line.qty_received, v_catalog_item.name;
      
      WHEN 'damaged' THEN
        -- Damaged items: Add to inventory but flag as damaged
        v_damaged_count := v_damaged_count + 1;
        v_movement_type := 'damaged';
        
        -- Continue to post below
      
      WHEN 'quarantine' THEN
        -- Quarantine items: Add to inventory but flag
        v_movement_type := 'received';
        
        -- Future: Could route to quarantine location
        -- For now, just add to inventory with event flag
      
      ELSE  -- 'accepted' or NULL
        v_movement_type := 'received';
    END CASE;
    
    -- Skip further processing for rejected items
    IF v_line.condition_status = 'rejected' THEN
      CONTINUE;
    END IF;
    
    -- 1. INSERT INVENTORY EVENT (ledger)
    INSERT INTO inventory.inventory_events (
      tenant_id,
      catalog_item_id,
      location_id,
      event_type,
      quantity_delta,
      payload,
      correlation_id,
      occurred_at,
      actor_user_id,
      last_event_id
    ) VALUES (
      v_tenant_id,
      v_line.catalog_item_id,
      COALESCE(v_line.destination_location_id, v_receipt.location_id),
      v_movement_type,
      v_line.qty_received,
      jsonb_build_object(
        'receipt_id', p_receipt_id,
        'receipt_number', v_receipt.receipt_number,
        'receipt_line_id', v_line.id,
        'line_number', v_line.line_number,
        'po_id', v_receipt.po_id,
        'po_line_id', v_line.po_line_id,
        'condition_status', v_line.condition_status,
        'unit_cost_actual', v_line.unit_cost_actual
      ),
      p_receipt_id,
      v_receipt.received_at,
      COALESCE(p_actor_user_id, v_receipt.created_by_user_id),
      v_event_id
    )
    ON CONFLICT (tenant_id, last_event_id) DO NOTHING;
    
    -- 2. INSERT STOCK MOVEMENT (authoritative ledger)
    INSERT INTO inventory.stock_movements (
      tenant_id,
      catalog_item_id,
      location_id,
      quantity_delta,
      movement_type,
      source_ref_type,
      source_ref_id,
      unit_cost,
      currency,
      notes,
      correlation_id,
      occurred_at,
      created_by_user_id,
      last_event_id
    ) VALUES (
      v_tenant_id,
      v_line.catalog_item_id,
      COALESCE(v_line.destination_location_id, v_receipt.location_id),
      v_line.qty_received,  -- POSITIVE (increase)
      v_movement_type,
      'receipt',
      p_receipt_id,
      COALESCE(v_line.unit_cost_actual, (
        SELECT unit_cost FROM supply_chain.purchase_order_lines 
        WHERE id = v_line.po_line_id
      )),
      'USD',
      CASE 
        WHEN v_line.condition_status = 'damaged' THEN 'Received as DAMAGED - ' || COALESCE(v_line.notes, '')
        WHEN v_line.condition_status = 'quarantine' THEN 'Received in QUARANTINE - ' || COALESCE(v_line.notes, '')
        ELSE 'Posted from receipt ' || v_receipt.receipt_number
      END,
      p_receipt_id,
      v_receipt.received_at,
      COALESCE(p_actor_user_id, v_receipt.created_by_user_id),
      v_event_id
    )
    ON CONFLICT (tenant_id, last_event_id) DO NOTHING
    RETURNING id INTO v_movement_id;
    
    IF v_movement_id IS NULL THEN
      RAISE NOTICE 'Stock movement for line % already exists (idempotent). Skipping.', v_line.line_number;
      v_skipped_count := v_skipped_count + 1;
      CONTINUE;
    END IF;
    
    -- 3. Stock balances updated automatically via trigger (maintain_stock_balances)
    
    -- 4. UPDATE PO LINE STATUS (if linked) - only for accepted/damaged/quarantine
    IF v_line.po_line_id IS NOT NULL THEN
      UPDATE supply_chain.purchase_order_lines
      SET
        qty_received = qty_received + v_line.qty_received,
        status = CASE
          WHEN qty_received + v_line.qty_received >= qty_ordered THEN 'fully_received'
          WHEN qty_received + v_line.qty_received > 0 THEN 'partially_received'
          ELSE status
        END,
        updated_at = NOW(),
        updated_by = COALESCE(p_actor_user_id, v_receipt.created_by_user_id)
      WHERE id = v_line.po_line_id
        AND tenant_id = v_tenant_id;
    END IF;
    
    v_posted_count := v_posted_count + 1;
    
    RAISE NOTICE '✓ Posted receipt line %: % x % (condition: %)',
      v_line.line_number, v_line.qty_received, v_catalog_item.name, v_line.condition_status;
  END LOOP;
  
  -- 5. UPDATE PO HEADER STATUS (if linked)
  IF v_receipt.po_id IS NOT NULL THEN
    UPDATE supply_chain.purchase_orders po
    SET status = (
      SELECT CASE
        WHEN COUNT(*) = COUNT(*) FILTER (WHERE pol.status = 'fully_received') THEN 'fully_received'
        WHEN COUNT(*) FILTER (WHERE pol.status IN ('fully_received', 'partially_received')) > 0 THEN 'partially_received'
        ELSE status
      END
      FROM supply_chain.purchase_order_lines pol
      WHERE pol.po_id = po.id
        AND pol.tenant_id = po.tenant_id
    ),
    updated_at = NOW(),
    updated_by = COALESCE(p_actor_user_id, v_receipt.created_by_user_id)
    WHERE id = v_receipt.po_id
      AND tenant_id = v_tenant_id;
  END IF;
  
  -- 6. UPDATE RECEIPT STATUS to 'confirmed'
  UPDATE supply_chain.receipts
  SET
    status = 'confirmed',
    updated_at = NOW(),
    updated_by = COALESCE(p_actor_user_id, v_receipt.created_by_user_id)
  WHERE id = p_receipt_id
    AND tenant_id = v_tenant_id;
  
  -- Build result
  v_result := jsonb_build_object(
    'success', true,
    'receipt_id', p_receipt_id,
    'receipt_number', v_receipt.receipt_number,
    'posted_lines', v_posted_count,
    'rejected_lines', v_rejected_count,
    'damaged_lines', v_damaged_count,
    'skipped_lines', v_skipped_count,
    'location_id', v_receipt.location_id,
    'location_name', v_location.name,
    'received_at', v_receipt.received_at,
    'message', format('Posted %s lines, rejected %s, damaged %s, skipped %s', 
      v_posted_count, v_rejected_count, v_damaged_count, v_skipped_count)
  );
  
  RAISE NOTICE '✅ Receipt % posted to inventory: % posted, % rejected, % damaged',
    p_receipt_id, v_posted_count, v_rejected_count, v_damaged_count;
  
  RETURN v_result;
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Failed to post receipt % to inventory: %', p_receipt_id, SQLERRM;
END;
$$;

COMMENT ON FUNCTION supply_chain.rpc_post_receipt_to_inventory_v2 IS 
  'Enhanced atomic receipt posting with support for condition_status and destination_location_id.
  Handles: accepted (normal), damaged (flagged), quarantine (flagged), rejected (not added to inventory).
  Updates receipt status to confirmed upon successful posting.';

GRANT EXECUTE ON FUNCTION supply_chain.rpc_post_receipt_to_inventory_v2 TO authenticated;

-- =====================================================================
-- RPC: Confirm Receipt (convenience wrapper)
-- Changes status from draft → confirmed and posts to inventory
-- =====================================================================

CREATE OR REPLACE FUNCTION supply_chain.rpc_confirm_receipt(
  p_receipt_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = supply_chain, inventory, public
AS $$
DECLARE
  v_tenant_id UUID;
  v_user_id UUID;
  v_receipt supply_chain.receipts%ROWTYPE;
  v_post_result JSONB;
BEGIN
  -- Get tenant and user from JWT
  v_tenant_id := (auth.jwt() ->> 'tenant_id')::UUID;
  v_user_id := (auth.jwt() ->> 'user_id')::UUID;
  
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  
  -- Fetch receipt
  SELECT * INTO v_receipt
  FROM supply_chain.receipts
  WHERE id = p_receipt_id
    AND tenant_id = v_tenant_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receipt not found';
  END IF;
  
  -- Check current status
  IF v_receipt.status = 'cancelled' THEN
    RAISE EXCEPTION 'Cannot confirm cancelled receipt';
  END IF;
  
  IF v_receipt.status = 'confirmed' THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'Receipt already confirmed',
      'receipt_id', p_receipt_id
    );
  END IF;
  
  -- Post to inventory (this will update status to 'confirmed')
  v_post_result := supply_chain.rpc_post_receipt_to_inventory_v2(
    p_receipt_id,
    v_user_id
  );
  
  RETURN v_post_result;
END;
$$;

COMMENT ON FUNCTION supply_chain.rpc_confirm_receipt IS 
  'Confirm a draft receipt and post it to inventory. Idempotent.';

GRANT EXECUTE ON FUNCTION supply_chain.rpc_confirm_receipt TO authenticated;

-- =====================================================================
-- RPC: Cancel Receipt
-- Mark receipt as cancelled (only if not yet posted)
-- =====================================================================

CREATE OR REPLACE FUNCTION supply_chain.rpc_cancel_receipt(
  p_receipt_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = supply_chain, inventory, public
AS $$
DECLARE
  v_tenant_id UUID;
  v_user_id UUID;
  v_receipt supply_chain.receipts%ROWTYPE;
BEGIN
  -- Get tenant and user from JWT
  v_tenant_id := (auth.jwt() ->> 'tenant_id')::UUID;
  v_user_id := (auth.jwt() ->> 'user_id')::UUID;
  
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  
  -- Fetch receipt
  SELECT * INTO v_receipt
  FROM supply_chain.receipts
  WHERE id = p_receipt_id
    AND tenant_id = v_tenant_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receipt not found';
  END IF;
  
  -- Check if already confirmed (cannot cancel after posting)
  IF v_receipt.status = 'confirmed' THEN
    RAISE EXCEPTION 'Cannot cancel confirmed receipt. Use reverse receipt function instead.';
  END IF;
  
  IF v_receipt.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'Receipt already cancelled',
      'receipt_id', p_receipt_id
    );
  END IF;
  
  -- Update status to cancelled
  UPDATE supply_chain.receipts
  SET
    status = 'cancelled',
    notes = CASE 
      WHEN p_reason IS NOT NULL THEN COALESCE(notes || E'\n\n', '') || 'CANCELLED: ' || p_reason
      ELSE notes
    END,
    updated_at = NOW(),
    updated_by = v_user_id
  WHERE id = p_receipt_id
    AND tenant_id = v_tenant_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'receipt_id', p_receipt_id,
    'receipt_number', v_receipt.receipt_number,
    'status', 'cancelled',
    'message', 'Receipt cancelled successfully'
  );
END;
$$;

COMMENT ON FUNCTION supply_chain.rpc_cancel_receipt IS 
  'Cancel a draft receipt. Cannot cancel confirmed receipts (use reverse instead).';

GRANT EXECUTE ON FUNCTION supply_chain.rpc_cancel_receipt TO authenticated;

-- =====================================================================
-- END OF ENHANCED RPCs
-- =====================================================================
