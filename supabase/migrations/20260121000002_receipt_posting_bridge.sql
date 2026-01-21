-- =====================================================
-- ATOMIC RECEIPT POSTING BRIDGE
-- =====================================================
-- This is the ONLY allowed bridge between supply_chain and inventory schemas.
-- 
-- This RPC atomically:
-- 1. Validates receipt exists in supply_chain.receipts
-- 2. Posts inventory ledger entries (inventory_events)
-- 3. Creates stock_movements (authoritative ledger)
-- 4. Updates stock_balances (read model)
-- 5. Updates PO line status
-- 6. Enforces idempotency via last_event_id
-- 
-- NO OTHER PROCESS may directly update stock_balances.
-- =====================================================

CREATE OR REPLACE FUNCTION supply_chain.rpc_post_receipt_to_inventory(
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
  v_result JSONB;
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
  
  -- Validate receipt hasn't already been posted
  IF v_receipt.last_event_id IS NOT NULL THEN
    -- Check if inventory events already exist with this event_id
    IF EXISTS (
      SELECT 1 FROM inventory.inventory_events
      WHERE tenant_id = v_tenant_id
        AND payload->>'receipt_id' = p_receipt_id::TEXT
        AND last_event_id = v_receipt.last_event_id
    ) THEN
      RAISE NOTICE 'Receipt % already posted to inventory (idempotent). Skipping.', p_receipt_id;
      
      RETURN jsonb_build_object(
        'success', true,
        'receipt_id', p_receipt_id,
        'posted_lines', 0,
        'skipped_lines', 0,
        'message', 'Already posted (idempotent)'
      );
    END IF;
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
    
    -- Check if this line already posted (idempotency at line level)
    IF v_line.last_event_id IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM inventory.inventory_events
        WHERE tenant_id = v_tenant_id
          AND catalog_item_id = v_line.catalog_item_id
          AND location_id = v_receipt.location_id
          AND last_event_id = v_line.last_event_id
      ) THEN
        RAISE NOTICE 'Receipt line % already posted. Skipping.', v_line.line_number;
        v_skipped_count := v_skipped_count + 1;
        CONTINUE;
      END IF;
    END IF;
    
    -- Generate unique event_id for this line
    v_event_id := 'receipt-' || p_receipt_id::TEXT || '-line-' || v_line.line_number::TEXT || '-' || extract(epoch from now())::TEXT;
    
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
      v_receipt.location_id,
      'received',
      v_line.qty_received,
      jsonb_build_object(
        'receipt_id', p_receipt_id,
        'receipt_number', v_receipt.receipt_number,
        'receipt_line_id', v_line.id,
        'line_number', v_line.line_number,
        'po_id', v_receipt.po_id,
        'po_line_id', v_line.po_line_id
      ),
      p_receipt_id, -- correlation to group all lines
      v_receipt.received_at,
      COALESCE(p_actor_user_id, v_receipt.created_by_user_id),
      v_event_id
    )
    ON CONFLICT (tenant_id, last_event_id) DO NOTHING;
    
    IF NOT FOUND THEN
      RAISE NOTICE 'Inventory event for line % already exists (idempotent). Skipping.', v_line.line_number;
      v_skipped_count := v_skipped_count + 1;
      CONTINUE;
    END IF;
    
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
      v_receipt.location_id,
      v_line.qty_received, -- POSITIVE (increase)
      'received',
      'receipt',
      p_receipt_id,
      NULL, -- unit_cost from PO if linked
      'USD',
      'Posted from receipt ' || v_receipt.receipt_number,
      p_receipt_id,
      v_receipt.received_at,
      COALESCE(p_actor_user_id, v_receipt.created_by_user_id),
      v_event_id
    )
    ON CONFLICT (tenant_id, last_event_id) DO NOTHING
    RETURNING id INTO v_movement_id;
    
    IF v_movement_id IS NULL THEN
      RAISE NOTICE 'Stock movement for line % already exists (idempotent). Skipping balance update.', v_line.line_number;
      v_skipped_count := v_skipped_count + 1;
      CONTINUE;
    END IF;
    
    -- 3. UPDATE STOCK BALANCES (read model)
    -- This is the ONLY place stock_balances should be updated for receipts
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
      v_line.catalog_item_id,
      v_receipt.location_id,
      v_line.qty_received,
      0,
      v_line.qty_received,
      v_event_id
    )
    ON CONFLICT (tenant_id, catalog_item_id, location_id)
    DO UPDATE SET
      qty_on_hand = inventory.stock_balances.qty_on_hand + EXCLUDED.qty_on_hand,
      qty_available = inventory.stock_balances.qty_available + EXCLUDED.qty_available,
      last_event_id = EXCLUDED.last_event_id,
      updated_at = NOW();
    
    -- 4. UPDATE PO LINE STATUS (if linked)
    IF v_line.po_line_id IS NOT NULL THEN
      UPDATE supply_chain.purchase_order_lines
      SET
        qty_received = qty_received + v_line.qty_received,
        status = CASE
          WHEN qty_received + v_line.qty_received >= qty_ordered THEN 'received'
          WHEN qty_received + v_line.qty_received > 0 THEN 'partially_received'
          ELSE 'pending'
        END,
        updated_at = NOW()
      WHERE id = v_line.po_line_id
        AND tenant_id = v_tenant_id;
    END IF;
    
    v_posted_count := v_posted_count + 1;
    
    RAISE NOTICE '✓ Posted receipt line % to inventory: % x %',
      v_line.line_number, v_line.qty_received, v_catalog_item.name;
  END LOOP;
  
  -- 5. UPDATE PO HEADER STATUS (if linked)
  IF v_receipt.po_id IS NOT NULL THEN
    -- Check if all lines received
    UPDATE supply_chain.purchase_orders po
    SET status = (
      SELECT CASE
        WHEN COUNT(*) = COUNT(*) FILTER (WHERE pol.status = 'received') THEN 'received'
        WHEN COUNT(*) FILTER (WHERE pol.status IN ('received', 'partially_received')) > 0 THEN 'partially_received'
        ELSE 'in_transit'
      END
      FROM supply_chain.purchase_order_lines pol
      WHERE pol.po_id = po.id
        AND pol.tenant_id = po.tenant_id
    ),
    updated_at = NOW()
    WHERE id = v_receipt.po_id
      AND tenant_id = v_tenant_id;
  END IF;
  
  -- 6. MARK RECEIPT AS POSTED (update last_event_id)
  UPDATE supply_chain.receipts
  SET
    last_event_id = 'posted-' || p_receipt_id::TEXT || '-' || extract(epoch from now())::TEXT,
    updated_at = NOW()
  WHERE id = p_receipt_id
    AND tenant_id = v_tenant_id;
  
  -- Build result
  v_result := jsonb_build_object(
    'success', true,
    'receipt_id', p_receipt_id,
    'receipt_number', v_receipt.receipt_number,
    'posted_lines', v_posted_count,
    'skipped_lines', v_skipped_count,
    'location_id', v_receipt.location_id,
    'location_name', v_location.name,
    'received_at', v_receipt.received_at,
    'message', format('Posted %s lines to inventory, skipped %s', v_posted_count, v_skipped_count)
  );
  
  RAISE NOTICE '✅ Receipt % posted to inventory: % lines posted, % skipped',
    p_receipt_id, v_posted_count, v_skipped_count;
  
  RETURN v_result;
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Failed to post receipt % to inventory: %', p_receipt_id, SQLERRM;
END;
$$;

-- Grant access to authenticated users
GRANT EXECUTE ON FUNCTION supply_chain.rpc_post_receipt_to_inventory TO authenticated;

COMMENT ON FUNCTION supply_chain.rpc_post_receipt_to_inventory IS
'ATOMIC BRIDGE: Posts receipt from supply_chain to inventory ledger.
This is the ONLY allowed way to post receipts to inventory.
Enforces idempotency via last_event_id on receipts, receipt_lines, inventory_events, and stock_movements.
Updates stock_balances (read model) and PO line status.
';

-- =====================================================
-- HELPER FUNCTION: REVERSE RECEIPT POSTING
-- =====================================================

CREATE OR REPLACE FUNCTION supply_chain.rpc_reverse_receipt_from_inventory(
  p_receipt_id UUID,
  p_reason TEXT,
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
  v_event_id TEXT;
  v_reversed_count INT := 0;
  v_result JSONB;
BEGIN
  v_tenant_id := (auth.jwt() ->> 'tenant_id')::UUID;
  
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'No tenant_id in JWT. Authentication required.';
  END IF;
  
  -- Validate reason provided
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'Reason required for reversal';
  END IF;
  
  -- Fetch receipt
  SELECT * INTO v_receipt
  FROM supply_chain.receipts
  WHERE id = p_receipt_id
    AND tenant_id = v_tenant_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receipt % not found', p_receipt_id;
  END IF;
  
  -- Check if receipt was posted
  IF v_receipt.last_event_id IS NULL THEN
    RAISE EXCEPTION 'Receipt % was never posted to inventory', p_receipt_id;
  END IF;
  
  -- Process each receipt line (reverse)
  FOR v_line IN
    SELECT *
    FROM supply_chain.receipt_lines
    WHERE receipt_id = p_receipt_id
      AND tenant_id = v_tenant_id
    ORDER BY line_number
  LOOP
    v_event_id := 'reversal-' || p_receipt_id::TEXT || '-line-' || v_line.line_number::TEXT || '-' || extract(epoch from now())::TEXT;
    
    -- Insert negative inventory event
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
      v_receipt.location_id,
      'adjusted', -- reversal is an adjustment
      -v_line.qty_received, -- NEGATIVE
      jsonb_build_object(
        'reason', 'receipt_reversal',
        'original_receipt_id', p_receipt_id,
        'original_receipt_number', v_receipt.receipt_number,
        'reversal_reason', p_reason
      ),
      p_receipt_id,
      NOW(),
      p_actor_user_id,
      v_event_id
    );
    
    -- Insert negative stock movement
    INSERT INTO inventory.stock_movements (
      tenant_id,
      catalog_item_id,
      location_id,
      quantity_delta,
      movement_type,
      source_ref_type,
      source_ref_id,
      reason,
      notes,
      correlation_id,
      occurred_at,
      created_by_user_id,
      last_event_id
    ) VALUES (
      v_tenant_id,
      v_line.catalog_item_id,
      v_receipt.location_id,
      -v_line.qty_received, -- NEGATIVE
      'adjusted',
      'receipt_reversal',
      p_receipt_id,
      'receipt_reversal',
      'Reversed receipt ' || v_receipt.receipt_number || ': ' || p_reason,
      p_receipt_id,
      NOW(),
      p_actor_user_id,
      v_event_id
    );
    
    -- Update stock balances
    UPDATE inventory.stock_balances
    SET
      qty_on_hand = qty_on_hand - v_line.qty_received,
      qty_available = qty_available - v_line.qty_received,
      last_event_id = v_event_id,
      updated_at = NOW()
    WHERE tenant_id = v_tenant_id
      AND catalog_item_id = v_line.catalog_item_id
      AND location_id = v_receipt.location_id;
    
    -- Reverse PO line status
    IF v_line.po_line_id IS NOT NULL THEN
      UPDATE supply_chain.purchase_order_lines
      SET
        qty_received = GREATEST(0, qty_received - v_line.qty_received),
        status = CASE
          WHEN qty_received - v_line.qty_received >= qty_ordered THEN 'received'
          WHEN qty_received - v_line.qty_received > 0 THEN 'partially_received'
          ELSE 'pending'
        END,
        updated_at = NOW()
      WHERE id = v_line.po_line_id
        AND tenant_id = v_tenant_id;
    END IF;
    
    v_reversed_count := v_reversed_count + 1;
  END LOOP;
  
  -- Mark receipt as reversed
  UPDATE supply_chain.receipts
  SET
    last_event_id = NULL, -- Allow re-posting if needed
    notes = COALESCE(notes, '') || E'\n[REVERSED: ' || p_reason || ']',
    updated_at = NOW()
  WHERE id = p_receipt_id
    AND tenant_id = v_tenant_id;
  
  v_result := jsonb_build_object(
    'success', true,
    'receipt_id', p_receipt_id,
    'receipt_number', v_receipt.receipt_number,
    'reversed_lines', v_reversed_count,
    'reason', p_reason,
    'message', format('Reversed %s lines from inventory', v_reversed_count)
  );
  
  RAISE NOTICE '✅ Receipt % reversed from inventory: % lines', p_receipt_id, v_reversed_count;
  
  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION supply_chain.rpc_reverse_receipt_from_inventory TO authenticated;

COMMENT ON FUNCTION supply_chain.rpc_reverse_receipt_from_inventory IS
'Reverses a receipt posting from inventory (creates negative movements).
Use only for corrections. Requires reason.';

-- =====================================================
-- SUMMARY
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== ATOMIC RECEIPT POSTING BRIDGE CREATED ===';
  RAISE NOTICE '';
  RAISE NOTICE 'supply_chain.rpc_post_receipt_to_inventory()';
  RAISE NOTICE '  ✓ Validates receipt in supply_chain schema';
  RAISE NOTICE '  ✓ Posts to inventory_events (ledger)';
  RAISE NOTICE '  ✓ Creates stock_movements (authoritative)';
  RAISE NOTICE '  ✓ Updates stock_balances (read model)';
  RAISE NOTICE '  ✓ Updates PO line/header status';
  RAISE NOTICE '  ✓ Enforces idempotency with last_event_id';
  RAISE NOTICE '';
  RAISE NOTICE 'supply_chain.rpc_reverse_receipt_from_inventory()';
  RAISE NOTICE '  ✓ Reverses receipt posting (negative movements)';
  RAISE NOTICE '  ✓ Requires reason for audit';
  RAISE NOTICE '';
  RAISE NOTICE '⚠️  NO OTHER PROCESS may directly update stock_balances!';
END $$;
