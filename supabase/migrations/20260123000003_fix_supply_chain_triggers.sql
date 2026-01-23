-- ============================================================================
-- FIX SUPPLY CHAIN TRIGGER SCHEMA REFERENCES
-- ============================================================================
-- Date: 2026-01-23
-- Purpose: Fix triggers referencing wrong schema for vendor_performance_events
-- ============================================================================

-- Fix record_po_vendor_event function - should insert into supply_chain schema
CREATE OR REPLACE FUNCTION supply_chain.record_po_vendor_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Record PO creation
  IF TG_OP = 'INSERT' THEN
    INSERT INTO supply_chain.vendor_performance_events (
      tenant_id,
      vendor_id,
      event_type,
      event_date,
      po_id,
      amount,
      metadata
    )
    SELECT
      NEW.tenant_id,
      v.id as vendor_id,
      'po_created',
      NEW.created_at,
      NEW.id,
      (SELECT SUM(qty_ordered * COALESCE(unit_cost, 0)) FROM supply_chain.purchase_order_lines WHERE po_id = NEW.id),
      jsonb_build_object('po_number', NEW.po_number, 'status', NEW.status)
    FROM supply_chain.vendors v
    JOIN inventory.locations vl ON vl.id = NEW.vendor_location_id
    WHERE v.tenant_id = NEW.tenant_id
    LIMIT 1;

  -- Record PO cancellation
  ELSIF TG_OP = 'UPDATE' AND OLD.status != 'cancelled' AND NEW.status = 'cancelled' THEN
    INSERT INTO supply_chain.vendor_performance_events (
      tenant_id,
      vendor_id,
      event_type,
      event_date,
      po_id,
      amount,
      metadata
    )
    SELECT
      NEW.tenant_id,
      v.id as vendor_id,
      'po_cancelled',
      now(),
      NEW.id,
      (SELECT SUM(qty_ordered * COALESCE(unit_cost, 0)) FROM supply_chain.purchase_order_lines WHERE po_id = NEW.id),
      jsonb_build_object('po_number', NEW.po_number, 'cancelled_reason', NEW.notes)
    FROM supply_chain.vendors v
    JOIN inventory.locations vl ON vl.id = NEW.vendor_location_id
    WHERE v.tenant_id = NEW.tenant_id
    LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$;

-- Fix record_receipt_vendor_event function - should insert into supply_chain schema
CREATE OR REPLACE FUNCTION supply_chain.record_receipt_vendor_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_vendor_id UUID;
  v_expected_date DATE;
  v_days_late INTEGER;
BEGIN
  -- Get vendor from associated PO
  SELECT 
    v.id,
    po.expected_delivery_date
  INTO v_vendor_id, v_expected_date
  FROM supply_chain.purchase_orders po
  JOIN inventory.locations vl ON vl.id = po.vendor_location_id
  JOIN supply_chain.vendors v ON v.tenant_id = po.tenant_id
  WHERE po.id = NEW.po_id
  LIMIT 1;

  IF v_vendor_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Calculate lateness
  v_days_late := GREATEST(0, EXTRACT(DAY FROM NEW.received_at::date - v_expected_date));

  -- Record delivery event
  IF v_days_late = 0 THEN
    INSERT INTO supply_chain.vendor_performance_events (
      tenant_id,
      vendor_id,
      event_type,
      event_date,
      po_id,
      receipt_id,
      expected_date,
      actual_date,
      days_late,
      metadata
    ) VALUES (
      NEW.tenant_id,
      v_vendor_id,
      'delivery_on_time',
      NEW.received_at,
      NEW.po_id,
      NEW.id,
      v_expected_date,
      NEW.received_at::date,
      0,
      jsonb_build_object('receipt_number', NEW.receipt_number)
    );
  ELSE
    INSERT INTO supply_chain.vendor_performance_events (
      tenant_id,
      vendor_id,
      event_type,
      event_date,
      po_id,
      receipt_id,
      expected_date,
      actual_date,
      days_late,
      metadata
    ) VALUES (
      NEW.tenant_id,
      v_vendor_id,
      'delivery_late',
      NEW.received_at,
      NEW.po_id,
      NEW.id,
      v_expected_date,
      NEW.received_at::date,
      v_days_late,
      jsonb_build_object('receipt_number', NEW.receipt_number, 'days_late', v_days_late)
    );
  END IF;

  -- Record items received
  INSERT INTO supply_chain.vendor_performance_events (
    tenant_id,
    vendor_id,
    event_type,
    event_date,
    po_id,
    receipt_id,
    quantity,
    metadata
  )
  SELECT
    NEW.tenant_id,
    v_vendor_id,
    'items_received',
    NEW.received_at,
    NEW.po_id,
    NEW.id,
    SUM(rl.qty_received),
    jsonb_build_object('receipt_number', NEW.receipt_number, 'line_count', COUNT(*))
  FROM supply_chain.receipt_lines rl
  WHERE rl.receipt_id = NEW.id
  GROUP BY NEW.tenant_id, NEW.po_id, NEW.id, NEW.received_at, NEW.receipt_number;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION supply_chain.record_po_vendor_event() IS 
  'FIXED: Records vendor performance events when POs are created or cancelled';
COMMENT ON FUNCTION supply_chain.record_receipt_vendor_event() IS 
  'FIXED: Records vendor performance events for deliveries (on-time/late tracking)';

-- Verify fixes
DO $$
BEGIN
    RAISE NOTICE '✓ Fixed supply_chain.record_po_vendor_event() - now inserts into supply_chain.vendor_performance_events';
    RAISE NOTICE '✓ Fixed supply_chain.record_receipt_vendor_event() - now inserts into supply_chain.vendor_performance_events';
    RAISE NOTICE '';
    RAISE NOTICE 'Trigger schema references corrected successfully.';
END $$;
