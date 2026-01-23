-- Migration: Add Event Emission for Reorder Alerts
-- Purpose: Emit reorder alert events to events_outbox
-- Phase: 3 (Event sourcing enhancement)

SET search_path TO inventory, public;

-- ============================================================================
-- Create trigger to emit reorder alert events
-- ============================================================================
CREATE OR REPLACE FUNCTION inventory.emit_reorder_alert_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only emit events for new alerts or status changes
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.status != NEW.status) THEN
    INSERT INTO inventory.events_outbox (
      event_id,
      tenant_id,
      event_type,
      aggregate_type,
      aggregate_id,
      payload,
      status
    ) VALUES (
      gen_random_uuid(),
      NEW.tenant_id,
      CASE TG_OP
        WHEN 'INSERT' THEN 'reorder_alert_created'
        WHEN 'UPDATE' THEN 'reorder_alert_status_changed'
      END,
      'reorder_alert',
      NEW.id,
      jsonb_build_object(
        'alert_id', NEW.id,
        'catalog_item_id', NEW.catalog_item_id,
        'location_id', NEW.location_id,
        'alert_type', NEW.alert_type,
        'priority', NEW.priority,
        'status', NEW.status,
        'current_qty', NEW.current_qty,
        'reorder_point', NEW.reorder_point,
        'suggested_order_qty', NEW.suggested_order_qty,
        'old_status', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END
      ),
      'pending'
    );
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_reorder_alert_events ON inventory.reorder_alerts;

CREATE TRIGGER trigger_reorder_alert_events
  AFTER INSERT OR UPDATE OF status ON inventory.reorder_alerts
  FOR EACH ROW
  EXECUTE FUNCTION inventory.emit_reorder_alert_event();

COMMENT ON FUNCTION inventory.emit_reorder_alert_event() IS 
  'Emits reorder alert events to events_outbox when alerts are created or status changes';

-- ============================================================================
-- Success confirmation
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Migration 20260120000086 completed successfully';
  RAISE NOTICE '✓ Added event emission for reorder alerts';
  RAISE NOTICE '✓ Events: reorder_alert_created, reorder_alert_status_changed';
END $$;
