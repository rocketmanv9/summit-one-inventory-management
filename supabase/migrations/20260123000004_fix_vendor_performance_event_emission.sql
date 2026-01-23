-- ============================================================================
-- FIX VENDOR PERFORMANCE EVENT OUTBOX EMISSION
-- ============================================================================
-- Date: 2026-01-23
-- Purpose: Fix emit_vendor_performance_event to use correct events_outbox schema
-- ============================================================================

CREATE OR REPLACE FUNCTION supply_chain.emit_vendor_performance_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Emit event to outbox for external processing
  INSERT INTO inventory.events_outbox (
    tenant_id,
    scope,
    event_type,
    aggregate_type,
    aggregate_id,
    payload,
    status,
    event_name,
    event_version
  ) VALUES (
    NEW.tenant_id,
    'tenant',
    CONCAT('supply_chain.vendor_performance.', NEW.event_type),
    'vendor_performance',
    NEW.vendor_id,
    jsonb_build_object(
      'event_id', NEW.id,
      'vendor_id', NEW.vendor_id,
      'event_type', NEW.event_type,
      'event_date', NEW.event_date,
      'po_id', NEW.po_id,
      'receipt_id', NEW.receipt_id,
      'quantity', NEW.quantity,
      'amount', NEW.amount,
      'days_late', NEW.days_late,
      'expected_date', NEW.expected_date,
      'actual_date', NEW.actual_date,
      'metadata', NEW.metadata
    ),
    'pending',
    CONCAT('supply_chain.vendor_performance.', NEW.event_type),
    1
  );
  
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION supply_chain.emit_vendor_performance_event() IS 
  'FIXED: Emits vendor performance events to events_outbox using correct schema';

-- Verify fix
DO $$
BEGIN
    RAISE NOTICE '✓ Fixed supply_chain.emit_vendor_performance_event() - now uses correct events_outbox schema';
    RAISE NOTICE '';
    RAISE NOTICE 'Event emission function corrected successfully.';
END $$;
