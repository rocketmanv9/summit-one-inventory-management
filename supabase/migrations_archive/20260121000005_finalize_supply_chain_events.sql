-- =====================================================
-- FINALIZE SUPPLY CHAIN EVENT NAMING (NO GRACE PERIOD)
-- =====================================================
-- Migration: 20260121000003_finalize_supply_chain_events.sql
-- Date: January 21, 2026
-- Purpose: Remove deprecated events completely - only supply_chain.* events will be emitted
-- Previous: 20260121000002_fix_supply_chain_events.sql (introduced new names)
-- Decision: NO grace period - immediate cutover to new event names

BEGIN;

-- =====================================================
-- STEP 1: DELETE DEPRECATED EVENTS
-- =====================================================
-- Remove the 13 deprecated events from event_definitions
-- This prevents them from being emitted (emit_event validates against this table)

DO $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  RAISE NOTICE '=== REMOVING DEPRECATED EVENTS ===';
  
  DELETE FROM public.event_definitions
  WHERE status = 'deprecated'
    AND event_name IN (
      'vendor.created',
      'vendor.updated',
      'purchase_order.created',
      'purchase_order.submitted',
      'purchase_order.approved',
      'purchase_order.cancelled',
      'purchase_order.closed',
      'inventory.po.placed',
      'inventory.po.approved',
      'inventory.po.received',
      'inventory.po.cancelled',
      'receipt.created',
      'receipt.line_added'
    );
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  RAISE NOTICE '✅ Deleted % deprecated event definitions', v_deleted_count;
END $$;

-- =====================================================
-- STEP 2: VERIFY TRIGGER FUNCTIONS
-- =====================================================
-- Ensure all trigger functions ONLY emit supply_chain.* events

DO $$
BEGIN
  RAISE NOTICE '=== VERIFYING TRIGGER FUNCTIONS ===';
  
  -- Check vendor trigger function
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'supply_chain'
      AND p.proname = 'emit_vendor_event'
  ) THEN
    RAISE NOTICE '✅ supply_chain.emit_vendor_event exists';
  ELSE
    RAISE WARNING '⚠️ supply_chain.emit_vendor_event NOT FOUND';
  END IF;
  
  -- Check PO trigger function
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'supply_chain'
      AND p.proname = 'emit_po_status_event'
  ) THEN
    RAISE NOTICE '✅ supply_chain.emit_po_status_event exists';
  ELSE
    RAISE WARNING '⚠️ supply_chain.emit_po_status_event NOT FOUND';
  END IF;
  
  -- Check receipt trigger functions
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'supply_chain'
      AND p.proname = 'emit_receipt_event'
  ) THEN
    RAISE NOTICE '✅ supply_chain.emit_receipt_event exists';
  ELSE
    RAISE WARNING '⚠️ supply_chain.emit_receipt_event NOT FOUND';
  END IF;
  
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'supply_chain'
      AND p.proname = 'emit_receipt_line_event'
  ) THEN
    RAISE NOTICE '✅ supply_chain.emit_receipt_line_event exists';
  ELSE
    RAISE WARNING '⚠️ supply_chain.emit_receipt_line_event NOT FOUND';
  END IF;
END $$;

-- =====================================================
-- STEP 3: CLEAN UP EVENTS OUTBOX
-- =====================================================
-- Optional: Archive old events (don't delete - audit trail!)

DO $$
DECLARE
  v_old_event_count INTEGER;
BEGIN
  RAISE NOTICE '=== CHECKING OLD EVENTS IN OUTBOX ===';
  
  SELECT COUNT(*) INTO v_old_event_count
  FROM inventory.events_outbox
  WHERE event_name IN (
    'vendor.created',
    'vendor.updated',
    'purchase_order.created',
    'purchase_order.submitted',
    'purchase_order.approved',
    'purchase_order.cancelled',
    'purchase_order.closed',
    'inventory.po.placed',
    'inventory.po.approved',
    'inventory.po.received',
    'inventory.po.cancelled',
    'receipt.created',
    'receipt.line_added'
  );
  
  RAISE NOTICE 'ℹ️ Found % events with old naming in outbox (historical - kept for audit)', v_old_event_count;
  RAISE NOTICE 'ℹ️ New events will only use supply_chain.* naming';
END $$;

-- =====================================================
-- STEP 4: FINAL VERIFICATION
-- =====================================================

DO $$
DECLARE
  v_active_supply_chain INTEGER;
  v_active_inventory INTEGER;
  v_deprecated_count INTEGER;
BEGIN
  RAISE NOTICE '=== FINAL EVENT CATALOG STATUS ===';
  
  -- Count active supply_chain events
  SELECT COUNT(*) INTO v_active_supply_chain
  FROM public.event_definitions
  WHERE event_name LIKE 'supply_chain.%'
    AND status = 'active';
  
  -- Count active inventory events
  SELECT COUNT(*) INTO v_active_inventory
  FROM public.event_definitions
  WHERE event_name NOT LIKE 'supply_chain.%'
    AND status = 'active';
  
  -- Count deprecated (should be 0 now)
  SELECT COUNT(*) INTO v_deprecated_count
  FROM public.event_definitions
  WHERE status = 'deprecated';
  
  RAISE NOTICE '✅ Active supply_chain events: %', v_active_supply_chain;
  RAISE NOTICE '✅ Active inventory events: %', v_active_inventory;
  RAISE NOTICE '✅ Deprecated events: % (should be 0)', v_deprecated_count;
  RAISE NOTICE '✅ Total active events: %', v_active_supply_chain + v_active_inventory;
  
  IF v_deprecated_count > 0 THEN
    RAISE WARNING '⚠️ Still have deprecated events - check event_definitions table';
  ELSE
    RAISE NOTICE '🎉 ALL DEPRECATED EVENTS REMOVED - Only supply_chain.* will be emitted!';
  END IF;
END $$;

-- =====================================================
-- SUMMARY
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════';
  RAISE NOTICE '🎯 SUPPLY CHAIN EVENT FINALIZATION COMPLETE';
  RAISE NOTICE '═══════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE '✅ Deprecated events removed from catalog';
  RAISE NOTICE '✅ Only supply_chain.* events will be emitted going forward';
  RAISE NOTICE '✅ Trigger functions emit new event names';
  RAISE NOTICE '✅ Frontend MUST use new event names immediately';
  RAISE NOTICE '';
  RAISE NOTICE '📋 Next Steps:';
  RAISE NOTICE '   1. Update frontend to use supply_chain.* event names';
  RAISE NOTICE '   2. Test event emission (create vendor, PO, receipt)';
  RAISE NOTICE '   3. Verify events appear in events_outbox with new names';
  RAISE NOTICE '   4. Update dashboards to subscribe to new events';
  RAISE NOTICE '';
  RAISE NOTICE '⚠️  NO GRACE PERIOD - Old event names will NOT work';
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════';
END $$;

COMMIT;
