-- =====================================================
-- FRONTEND RPC WRAPPERS & COMPATIBILITY LAYER
-- =====================================================
-- This migration creates stable RPC interfaces for the frontend
-- that abstract the supply_chain <-> inventory boundary.
-- 
-- Frontend should ONLY call these RPCs, never directly manipulate tables.
-- =====================================================

-- =====================================================
-- SUPPLY_CHAIN RPCs (Frontend-facing)
-- =====================================================

-- 1. CREATE PURCHASE ORDER
CREATE OR REPLACE FUNCTION supply_chain.rpc_create_purchase_order(
  p_vendor_id UUID,
  p_po_number TEXT,
  p_delivery_location_id UUID,
  p_lines JSONB, -- Array of {catalog_item_id, qty_ordered, unit_cost}
  p_expected_delivery_date TIMESTAMPTZ DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = supply_chain, inventory, public
AS $$
DECLARE
  v_tenant_id UUID;
  v_po_id UUID;
  v_line JSONB;
  v_line_number INT := 0;
  v_result JSONB;
BEGIN
  v_tenant_id := (auth.jwt() ->> 'tenant_id')::UUID;
  
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  
  -- Insert PO header
  INSERT INTO supply_chain.purchase_orders (
    tenant_id,
    vendor_id,
    po_number,
    order_date,
    expected_delivery_date,
    delivery_location_id,
    status,
    notes,
    created_by_user_id
  ) VALUES (
    v_tenant_id,
    p_vendor_id,
    p_po_number,
    NOW(),
    p_expected_delivery_date,
    p_delivery_location_id,
    'draft',
    p_notes,
    (auth.jwt() ->> 'user_id')::UUID
  )
  RETURNING id INTO v_po_id;
  
  -- Insert PO lines
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_line_number := v_line_number + 1;
    
    INSERT INTO supply_chain.purchase_order_lines (
      tenant_id,
      po_id,
      line_number,
      catalog_item_id,
      qty_ordered,
      unit_cost,
      status
    ) VALUES (
      v_tenant_id,
      v_po_id,
      v_line_number,
      (v_line->>'catalog_item_id')::UUID,
      (v_line->>'qty_ordered')::NUMERIC,
      (v_line->>'unit_cost')::NUMERIC,
      'pending'
    );
  END LOOP;
  
  v_result := jsonb_build_object(
    'success', true,
    'po_id', v_po_id,
    'po_number', p_po_number,
    'line_count', v_line_number,
    'status', 'draft'
  );
  
  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION supply_chain.rpc_create_purchase_order TO authenticated;

COMMENT ON FUNCTION supply_chain.rpc_create_purchase_order IS
'Frontend RPC: Create a purchase order with lines.
Returns: {success, po_id, po_number, line_count, status}';

-- 2. CREATE RECEIPT (and optionally post to inventory)
CREATE OR REPLACE FUNCTION supply_chain.rpc_create_receipt(
  p_receipt_number TEXT,
  p_location_id UUID,
  p_lines JSONB, -- Array of {catalog_item_id, qty_received, po_line_id?}
  p_po_id UUID DEFAULT NULL,
  p_received_at TIMESTAMPTZ DEFAULT NOW(),
  p_notes TEXT DEFAULT NULL,
  p_auto_post BOOLEAN DEFAULT TRUE -- Auto-post to inventory
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = supply_chain, inventory, public
AS $$
DECLARE
  v_tenant_id UUID;
  v_receipt_id UUID;
  v_line JSONB;
  v_line_number INT := 0;
  v_post_result JSONB;
  v_result JSONB;
BEGIN
  v_tenant_id := (auth.jwt() ->> 'tenant_id')::UUID;
  
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  
  -- Insert receipt header
  INSERT INTO supply_chain.receipts (
    tenant_id,
    receipt_number,
    location_id,
    po_id,
    received_at,
    notes,
    created_by_user_id
  ) VALUES (
    v_tenant_id,
    p_receipt_number,
    p_location_id,
    p_po_id,
    p_received_at,
    p_notes,
    (auth.jwt() ->> 'user_id')::UUID
  )
  RETURNING id INTO v_receipt_id;
  
  -- Insert receipt lines
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_line_number := v_line_number + 1;
    
    INSERT INTO supply_chain.receipt_lines (
      tenant_id,
      receipt_id,
      line_number,
      catalog_item_id,
      qty_received,
      po_line_id
    ) VALUES (
      v_tenant_id,
      v_receipt_id,
      v_line_number,
      (v_line->>'catalog_item_id')::UUID,
      (v_line->>'qty_received')::NUMERIC,
      (v_line->>'po_line_id')::UUID
    );
  END LOOP;
  
  -- Auto-post to inventory if requested
  IF p_auto_post THEN
    v_post_result := supply_chain.rpc_post_receipt_to_inventory(
      v_receipt_id,
      (auth.jwt() ->> 'user_id')::UUID
    );
    
    v_result := jsonb_build_object(
      'success', true,
      'receipt_id', v_receipt_id,
      'receipt_number', p_receipt_number,
      'line_count', v_line_number,
      'posted_to_inventory', true,
      'post_result', v_post_result
    );
  ELSE
    v_result := jsonb_build_object(
      'success', true,
      'receipt_id', v_receipt_id,
      'receipt_number', p_receipt_number,
      'line_count', v_line_number,
      'posted_to_inventory', false
    );
  END IF;
  
  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION supply_chain.rpc_create_receipt TO authenticated;

COMMENT ON FUNCTION supply_chain.rpc_create_receipt IS
'Frontend RPC: Create a receipt (and optionally auto-post to inventory).
Set p_auto_post=false to create receipt without posting.
Returns: {success, receipt_id, receipt_number, line_count, posted_to_inventory, post_result}';

-- =====================================================
-- INVENTORY RPCs (Frontend-facing)
-- =====================================================

-- 3. ISSUE INVENTORY
CREATE OR REPLACE FUNCTION inventory.rpc_issue_inventory(
  p_location_id UUID,
  p_items JSONB, -- Array of {catalog_item_id, qty_issued}
  p_issued_to_type TEXT DEFAULT NULL, -- 'job', 'truck', 'person', 'other'
  p_issued_to_ref TEXT DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = inventory, public
AS $$
DECLARE
  v_tenant_id UUID;
  v_item JSONB;
  v_event_id TEXT;
  v_issued_count INT := 0;
  v_result JSONB;
BEGIN
  v_tenant_id := (auth.jwt() ->> 'tenant_id')::UUID;
  
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  
  -- Process each item
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_event_id := 'issue-' || gen_random_uuid()::TEXT || '-' || extract(epoch from now())::TEXT;
    
    -- Check availability
    IF NOT EXISTS (
      SELECT 1 FROM inventory.stock_balances
      WHERE tenant_id = v_tenant_id
        AND catalog_item_id = (v_item->>'catalog_item_id')::UUID
        AND location_id = p_location_id
        AND qty_available >= (v_item->>'qty_issued')::NUMERIC
    ) THEN
      RAISE EXCEPTION 'Insufficient stock for item % at location %',
        v_item->>'catalog_item_id', p_location_id;
    END IF;
    
    -- Insert inventory event
    INSERT INTO inventory.inventory_events (
      tenant_id,
      catalog_item_id,
      location_id,
      event_type,
      quantity_delta,
      payload,
      occurred_at,
      actor_user_id,
      last_event_id
    ) VALUES (
      v_tenant_id,
      (v_item->>'catalog_item_id')::UUID,
      p_location_id,
      'issue',
      -(v_item->>'qty_issued')::NUMERIC, -- NEGATIVE
      jsonb_build_object(
        'issued_to_type', p_issued_to_type,
        'issued_to_ref', p_issued_to_ref,
        'reason', p_reason
      ),
      NOW(),
      (auth.jwt() ->> 'user_id')::UUID,
      v_event_id
    );
    
    -- Insert stock movement
    INSERT INTO inventory.stock_movements (
      tenant_id,
      catalog_item_id,
      location_id,
      quantity_delta,
      movement_type,
      source_ref_type,
      reason,
      notes,
      occurred_at,
      created_by_user_id,
      last_event_id
    ) VALUES (
      v_tenant_id,
      (v_item->>'catalog_item_id')::UUID,
      p_location_id,
      -(v_item->>'qty_issued')::NUMERIC, -- NEGATIVE
      'issued',
      p_issued_to_type,
      p_reason,
      p_notes,
      NOW(),
      (auth.jwt() ->> 'user_id')::UUID,
      v_event_id
    );
    
    -- Update stock balances
    UPDATE inventory.stock_balances
    SET
      qty_on_hand = qty_on_hand - (v_item->>'qty_issued')::NUMERIC,
      qty_available = qty_available - (v_item->>'qty_issued')::NUMERIC,
      last_event_id = v_event_id,
      updated_at = NOW()
    WHERE tenant_id = v_tenant_id
      AND catalog_item_id = (v_item->>'catalog_item_id')::UUID
      AND location_id = p_location_id;
    
    v_issued_count := v_issued_count + 1;
  END LOOP;
  
  v_result := jsonb_build_object(
    'success', true,
    'issued_count', v_issued_count,
    'location_id', p_location_id,
    'issued_to', jsonb_build_object('type', p_issued_to_type, 'ref', p_issued_to_ref)
  );
  
  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION inventory.rpc_issue_inventory TO authenticated;

COMMENT ON FUNCTION inventory.rpc_issue_inventory IS
'Frontend RPC: Issue inventory from a location.
Validates availability, creates events and movements, updates balances.
Returns: {success, issued_count, location_id, issued_to}';

-- 4. ADJUST INVENTORY
CREATE OR REPLACE FUNCTION inventory.rpc_adjust_inventory(
  p_location_id UUID,
  p_catalog_item_id UUID,
  p_new_qty NUMERIC,
  p_reason TEXT, -- REQUIRED: 'count_variance', 'damage', 'theft', 'expiration', 'other'
  p_notes TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = inventory, public
AS $$
DECLARE
  v_tenant_id UUID;
  v_current_qty NUMERIC;
  v_delta NUMERIC;
  v_event_id TEXT;
  v_result JSONB;
BEGIN
  v_tenant_id := (auth.jwt() ->> 'tenant_id')::UUID;
  
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
  
  v_event_id := 'adjust-' || gen_random_uuid()::TEXT || '-' || extract(epoch from now())::TEXT;
  
  -- Insert inventory event
  INSERT INTO inventory.inventory_events (
    tenant_id,
    catalog_item_id,
    location_id,
    event_type,
    quantity_delta,
    payload,
    occurred_at,
    actor_user_id,
    last_event_id
  ) VALUES (
    v_tenant_id,
    p_catalog_item_id,
    p_location_id,
    'adjust',
    v_delta,
    jsonb_build_object(
      'reason', p_reason,
      'old_qty', v_current_qty,
      'new_qty', p_new_qty,
      'notes', p_notes
    ),
    NOW(),
    (auth.jwt() ->> 'user_id')::UUID,
    v_event_id
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
    NOW(),
    (auth.jwt() ->> 'user_id')::UUID,
    v_event_id
  );
  
  -- Update stock balances
  INSERT INTO inventory.stock_balances (
    tenant_id,
    catalog_item_id,
    location_id,
    qty_on_hand,
    qty_reserved,
    qty_available,
    last_event_id
  ) VALUES (
    v_tenant_id,
    p_catalog_item_id,
    p_location_id,
    p_new_qty,
    0,
    p_new_qty,
    v_event_id
  )
  ON CONFLICT (tenant_id, catalog_item_id, location_id)
  DO UPDATE SET
    qty_on_hand = EXCLUDED.qty_on_hand,
    qty_available = stock_balances.qty_available + (EXCLUDED.qty_on_hand - stock_balances.qty_on_hand),
    last_event_id = EXCLUDED.last_event_id,
    updated_at = NOW();
  
  v_result := jsonb_build_object(
    'success', true,
    'catalog_item_id', p_catalog_item_id,
    'location_id', p_location_id,
    'old_qty', v_current_qty,
    'new_qty', p_new_qty,
    'delta', v_delta,
    'reason', p_reason
  );
  
  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION inventory.rpc_adjust_inventory TO authenticated;

COMMENT ON FUNCTION inventory.rpc_adjust_inventory IS
'Frontend RPC: Adjust inventory to a new quantity.
Requires reason (count_variance, damage, theft, expiration, other).
Returns: {success, old_qty, new_qty, delta, reason}';

-- =====================================================
-- COMPATIBILITY WRAPPER FOR OLD inventory.rpc_inv_receive
-- =====================================================
-- If frontend currently calls inventory.rpc_inv_receive, redirect to supply_chain

CREATE OR REPLACE FUNCTION inventory.rpc_inv_receive(
  p_receipt_number TEXT,
  p_location_id UUID,
  p_lines JSONB,
  p_po_id UUID DEFAULT NULL,
  p_received_at TIMESTAMPTZ DEFAULT NOW(),
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RAISE NOTICE 'DEPRECATED: inventory.rpc_inv_receive() → Use supply_chain.rpc_create_receipt()';
  
  -- Redirect to new supply_chain RPC
  RETURN supply_chain.rpc_create_receipt(
    p_receipt_number,
    p_location_id,
    p_po_id,
    p_received_at,
    p_notes,
    p_lines,
    TRUE -- auto_post
  );
END;
$$;

GRANT EXECUTE ON FUNCTION inventory.rpc_inv_receive TO authenticated;

COMMENT ON FUNCTION inventory.rpc_inv_receive IS
'DEPRECATED: Compatibility wrapper for supply_chain.rpc_create_receipt().
Migrate frontend to call supply_chain.rpc_create_receipt() directly.';

-- =====================================================
-- SUMMARY
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== FRONTEND RPC WRAPPERS CREATED ===';
  RAISE NOTICE '';
  RAISE NOTICE 'SUPPLY_CHAIN RPCs:';
  RAISE NOTICE '  ✓ rpc_create_purchase_order(vendor_id, po_number, lines, ...)';
  RAISE NOTICE '  ✓ rpc_create_receipt(receipt_number, location_id, lines, auto_post, ...)';
  RAISE NOTICE '  ✓ rpc_post_receipt_to_inventory(receipt_id) [ATOMIC BRIDGE]';
  RAISE NOTICE '  ✓ rpc_reverse_receipt_from_inventory(receipt_id, reason)';
  RAISE NOTICE '';
  RAISE NOTICE 'INVENTORY RPCs:';
  RAISE NOTICE '  ✓ rpc_issue_inventory(location_id, items, issued_to, ...)';
  RAISE NOTICE '  ✓ rpc_adjust_inventory(location_id, item_id, new_qty, reason, ...)';
  RAISE NOTICE '  ✓ rpc_inv_transfer_create(...) [existing]';
  RAISE NOTICE '  ✓ rpc_inv_reserve(...) [existing]';
  RAISE NOTICE '  ✓ rpc_inv_cycle_count_start(...) [existing]';
  RAISE NOTICE '  ✓ rpc_inv_asset_assign(...) [existing]';
  RAISE NOTICE '';
  RAISE NOTICE 'COMPATIBILITY:';
  RAISE NOTICE '  ✓ inventory.rpc_inv_receive() → supply_chain.rpc_create_receipt()';
  RAISE NOTICE '';
  RAISE NOTICE 'Frontend should ONLY call RPCs, never directly manipulate tables.';
END $$;
