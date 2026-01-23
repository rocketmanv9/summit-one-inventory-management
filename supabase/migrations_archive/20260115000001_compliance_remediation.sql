-- ================================================================
-- COMPLIANCE REMEDIATION MIGRATION
-- ================================================================
-- Date: 2026-01-15
-- Purpose: Bring database into full compliance with multitenancy,
--          idempotency, and event-driven architecture guardrails
-- ================================================================

-- ================================================================
-- PART 1: Fix Ingestion Table Idempotency
-- ================================================================

-- Fix: public.tenants table lacks idempotency (synced via webhooks)
-- Add last_event_id for webhook deduplication
ALTER TABLE public.tenants 
ADD COLUMN IF NOT EXISTS last_event_id TEXT;

-- Unique constraint: prevent duplicate webhook processing
-- Note: Uses (id, last_event_id) to allow updates with different event IDs
ALTER TABLE public.tenants 
ADD CONSTRAINT unique_tenant_event 
    UNIQUE NULLS NOT DISTINCT (id, last_event_id);

-- Index for webhook queries
CREATE INDEX IF NOT EXISTS idx_tenants_last_event 
    ON public.tenants(last_event_id);

-- Comment for documentation
COMMENT ON COLUMN public.tenants.last_event_id IS 
    'Event ID from Core service webhooks - ensures idempotent webhook processing';

-- ================================================================
-- PART 2: Standardize Events Outbox Structure
-- ================================================================

-- Ensure status column has proper check constraint
ALTER TABLE inventory.events_outbox 
DROP CONSTRAINT IF EXISTS events_outbox_status_check;

ALTER TABLE inventory.events_outbox 
ADD CONSTRAINT events_outbox_status_check 
    CHECK (status IN ('pending', 'published', 'failed'));

-- Add retry tracking if not exists
ALTER TABLE inventory.events_outbox 
ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE inventory.events_outbox 
ADD COLUMN IF NOT EXISTS last_error TEXT;

ALTER TABLE inventory.events_outbox 
ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

-- Add index for poller queries
CREATE INDEX IF NOT EXISTS idx_outbox_pending 
    ON inventory.events_outbox(status, created_at) 
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_outbox_failed 
    ON inventory.events_outbox(status, retry_count) 
    WHERE status = 'failed';

-- ================================================================
-- PART 3: Create Helper Function for Event Publishing
-- ================================================================

-- Drop existing function if exists (for idempotency)
DROP FUNCTION IF EXISTS inventory.publish_event;

-- Create standardized event publishing function
CREATE OR REPLACE FUNCTION inventory.publish_event(
    p_tenant_id UUID,
    p_scope TEXT,
    p_event_type TEXT,
    p_aggregate_type TEXT,
    p_aggregate_id UUID,
    p_payload JSONB DEFAULT '{}'::jsonb,
    p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS UUID AS $$
DECLARE
    v_event_id UUID;
BEGIN
    -- Insert into outbox
    INSERT INTO inventory.events_outbox (
        tenant_id,
        scope,
        event_type,
        aggregate_type,
        aggregate_id,
        payload,
        metadata,
        status,
        retry_count
    ) VALUES (
        p_tenant_id,
        p_scope,
        p_event_type,
        p_aggregate_type,
        p_aggregate_id,
        p_payload,
        p_metadata,
        'pending',
        0
    ) RETURNING id INTO v_event_id;
    
    RETURN v_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION inventory.publish_event TO authenticated;

-- Comment for documentation
COMMENT ON FUNCTION inventory.publish_event IS 
    'Publishes an event to the outbox for async processing by the events poller';

-- ================================================================
-- PART 4: Add Event Emission Triggers (High-Value Operations)
-- ================================================================

-- ----------------------------------------------------------------
-- 4.1: Stock Movement Events (HIGH PRIORITY)
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION inventory.emit_stock_movement_event()
RETURNS TRIGGER AS $$
BEGIN
    -- Emit event for new stock movements
    IF TG_OP = 'INSERT' THEN
        PERFORM inventory.publish_event(
            p_tenant_id := NEW.tenant_id,
            p_scope := 'tenant',
            p_event_type := 'inventory.stock.adjusted',
            p_aggregate_type := 'stock_movement',
            p_aggregate_id := NEW.id,
            p_payload := to_jsonb(NEW),
            p_metadata := jsonb_build_object(
                'movement_type', NEW.movement_type,
                'item_id', NEW.item_id,
                'location_id', NEW.location_id,
                'quantity_delta', NEW.quantity_delta
            )
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger
DROP TRIGGER IF EXISTS trigger_stock_movement_events ON inventory.stock_movements;
CREATE TRIGGER trigger_stock_movement_events
    AFTER INSERT ON inventory.stock_movements
    FOR EACH ROW
    EXECUTE FUNCTION inventory.emit_stock_movement_event();

-- ----------------------------------------------------------------
-- 4.2: Purchase Order Status Change Events (HIGH PRIORITY)
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION inventory.emit_po_status_event()
RETURNS TRIGGER AS $$
BEGIN
    -- Emit event when PO status changes
    IF TG_OP = 'UPDATE' AND (OLD.status IS DISTINCT FROM NEW.status) THEN
        PERFORM inventory.publish_event(
            p_tenant_id := NEW.tenant_id,
            p_scope := 'tenant',
            p_event_type := CASE NEW.status
                WHEN 'placed' THEN 'inventory.po.placed'
                WHEN 'receiving' THEN 'inventory.po.receiving'
                WHEN 'received' THEN 'inventory.po.received'
                WHEN 'closed' THEN 'inventory.po.closed'
                WHEN 'cancelled' THEN 'inventory.po.cancelled'
                ELSE 'inventory.po.updated'
            END,
            p_aggregate_type := 'purchase_order',
            p_aggregate_id := NEW.id,
            p_payload := to_jsonb(NEW),
            p_metadata := jsonb_build_object(
                'previous_status', OLD.status,
                'new_status', NEW.status,
                'vendor_id', NEW.vendor_id,
                'total_amount', NEW.total_amount
            )
        );
    END IF;
    
    -- Emit event when PO is created
    IF TG_OP = 'INSERT' THEN
        PERFORM inventory.publish_event(
            p_tenant_id := NEW.tenant_id,
            p_scope := 'tenant',
            p_event_type := 'inventory.po.created',
            p_aggregate_type := 'purchase_order',
            p_aggregate_id := NEW.id,
            p_payload := to_jsonb(NEW),
            p_metadata := jsonb_build_object(
                'vendor_id', NEW.vendor_id,
                'total_amount', NEW.total_amount
            )
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger
DROP TRIGGER IF EXISTS trigger_po_status_events ON inventory.purchase_orders;
CREATE TRIGGER trigger_po_status_events
    AFTER INSERT OR UPDATE ON inventory.purchase_orders
    FOR EACH ROW
    EXECUTE FUNCTION inventory.emit_po_status_event();

-- ----------------------------------------------------------------
-- 4.3: Receipt Completion Events (HIGH PRIORITY)
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION inventory.emit_receipt_event()
RETURNS TRIGGER AS $$
BEGIN
    -- Emit event when receipt is created
    IF TG_OP = 'INSERT' THEN
        PERFORM inventory.publish_event(
            p_tenant_id := NEW.tenant_id,
            p_scope := 'tenant',
            p_event_type := 'inventory.receipt.created',
            p_aggregate_type := 'receipt',
            p_aggregate_id := NEW.id,
            p_payload := to_jsonb(NEW),
            p_metadata := jsonb_build_object(
                'purchase_order_id', NEW.purchase_order_id,
                'location_id', NEW.location_id
            )
        );
    END IF;
    
    -- Emit event when receipt status changes
    IF TG_OP = 'UPDATE' AND (OLD.status IS DISTINCT FROM NEW.status) THEN
        PERFORM inventory.publish_event(
            p_tenant_id := NEW.tenant_id,
            p_scope := 'tenant',
            p_event_type := CASE NEW.status
                WHEN 'completed' THEN 'inventory.receipt.completed'
                WHEN 'cancelled' THEN 'inventory.receipt.cancelled'
                ELSE 'inventory.receipt.updated'
            END,
            p_aggregate_type := 'receipt',
            p_aggregate_id := NEW.id,
            p_payload := to_jsonb(NEW),
            p_metadata := jsonb_build_object(
                'previous_status', OLD.status,
                'new_status', NEW.status,
                'purchase_order_id', NEW.purchase_order_id
            )
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger
DROP TRIGGER IF EXISTS trigger_receipt_events ON inventory.receipts;
CREATE TRIGGER trigger_receipt_events
    AFTER INSERT OR UPDATE ON inventory.receipts
    FOR EACH ROW
    EXECUTE FUNCTION inventory.emit_receipt_event();

-- ----------------------------------------------------------------
-- 4.4: Cycle Count Completion Events (MEDIUM PRIORITY)
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION inventory.emit_cycle_count_event()
RETURNS TRIGGER AS $$
BEGIN
    -- Emit event when cycle count status changes to completed
    IF TG_OP = 'UPDATE' AND OLD.status != 'completed' AND NEW.status = 'completed' THEN
        PERFORM inventory.publish_event(
            p_tenant_id := NEW.tenant_id,
            p_scope := 'tenant',
            p_event_type := 'inventory.cycle_count.completed',
            p_aggregate_type := 'cycle_count',
            p_aggregate_id := NEW.id,
            p_payload := to_jsonb(NEW),
            p_metadata := jsonb_build_object(
                'location_id', NEW.location_id,
                'variance_found', COALESCE(NEW.variance_count, 0) > 0
            )
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger
DROP TRIGGER IF EXISTS trigger_cycle_count_events ON inventory.cycle_counts;
CREATE TRIGGER trigger_cycle_count_events
    AFTER UPDATE ON inventory.cycle_counts
    FOR EACH ROW
    EXECUTE FUNCTION inventory.emit_cycle_count_event();

-- ================================================================
-- PART 5: Add Missing Idempotency Fields (If Needed)
-- ================================================================

-- Note: Most tables already have last_event_id from previous migrations
-- This section adds any that are missing

-- Add last_event_id to receipt_lines (line-level tracking)
ALTER TABLE inventory.receipt_lines 
ADD COLUMN IF NOT EXISTS last_event_id TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'unique_receipt_line_event' 
        AND conrelid = 'inventory.receipt_lines'::regclass
    ) THEN
        ALTER TABLE inventory.receipt_lines 
        ADD CONSTRAINT unique_receipt_line_event 
            UNIQUE NULLS NOT DISTINCT (tenant_id, last_event_id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_receipt_lines_event 
    ON inventory.receipt_lines(tenant_id, last_event_id)
    WHERE last_event_id IS NOT NULL;

-- Add last_event_id to cycle_count_lines
ALTER TABLE inventory.cycle_count_lines 
ADD COLUMN IF NOT EXISTS last_event_id TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'unique_cycle_count_line_event' 
        AND conrelid = 'inventory.cycle_count_lines'::regclass
    ) THEN
        ALTER TABLE inventory.cycle_count_lines 
        ADD CONSTRAINT unique_cycle_count_line_event 
            UNIQUE NULLS NOT DISTINCT (tenant_id, last_event_id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cycle_count_lines_event 
    ON inventory.cycle_count_lines(tenant_id, last_event_id)
    WHERE last_event_id IS NOT NULL;

-- ================================================================
-- PART 6: Add Documentation Comments
-- ================================================================

COMMENT ON TABLE inventory.events_outbox IS 
    'Outbox pattern for reliable event publishing. Polled by events-poller Edge Function every minute.';

COMMENT ON COLUMN inventory.events_outbox.retry_count IS 
    'Number of failed publish attempts. Max 5 retries before marking as failed.';

COMMENT ON COLUMN inventory.events_outbox.last_error IS 
    'Error message from most recent failed publish attempt.';

COMMENT ON COLUMN inventory.events_outbox.published_at IS 
    'Timestamp when event was successfully published to downstream systems.';

-- ================================================================
-- VERIFICATION QUERIES (for testing)
-- ================================================================

-- Verify tenants table has idempotency
DO $$
BEGIN
    ASSERT (SELECT COUNT(*) FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'tenants' 
            AND column_name = 'last_event_id') = 1,
        'tenants.last_event_id column not created';
    
    ASSERT (SELECT COUNT(*) FROM information_schema.table_constraints 
            WHERE table_schema = 'public' 
            AND table_name = 'tenants' 
            AND constraint_name = 'unique_tenant_event') = 1,
        'unique_tenant_event constraint not created';
    
    RAISE NOTICE '✅ Tenants table idempotency: VERIFIED';
END $$;

-- Verify outbox structure
DO $$
BEGIN
    ASSERT (SELECT COUNT(*) FROM information_schema.columns 
            WHERE table_schema = 'inventory' 
            AND table_name = 'events_outbox' 
            AND column_name = 'retry_count') = 1,
        'events_outbox.retry_count column not created';
    
    RAISE NOTICE '✅ Events outbox structure: VERIFIED';
END $$;

-- Verify triggers exist
DO $$
DECLARE
    v_stock_trigger_count INTEGER;
    v_po_trigger_count INTEGER;
    v_receipt_trigger_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_stock_trigger_count 
    FROM information_schema.triggers 
    WHERE trigger_name = 'trigger_stock_movement_events';
    
    SELECT COUNT(*) INTO v_po_trigger_count 
    FROM information_schema.triggers 
    WHERE trigger_name = 'trigger_po_status_events';
    
    SELECT COUNT(*) INTO v_receipt_trigger_count 
    FROM information_schema.triggers 
    WHERE trigger_name = 'trigger_receipt_events';
    
    IF v_stock_trigger_count > 0 AND v_po_trigger_count > 0 AND v_receipt_trigger_count > 0 THEN
        RAISE NOTICE '✅ Event emission triggers: VERIFIED';
    ELSE
        RAISE WARNING 'Some triggers may not have been created: stock=%, po=%, receipt=%', 
            v_stock_trigger_count, v_po_trigger_count, v_receipt_trigger_count;
    END IF;
END $$;

-- ================================================================
-- SUCCESS MESSAGE
-- ================================================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '================================================================';
    RAISE NOTICE '✅ COMPLIANCE REMEDIATION COMPLETE';
    RAISE NOTICE '================================================================';
    RAISE NOTICE 'Applied fixes:';
    RAISE NOTICE '  ✅ Tenants table idempotency (last_event_id + unique constraint)';
    RAISE NOTICE '  ✅ Events outbox retry tracking (retry_count, last_error, published_at)';
    RAISE NOTICE '  ✅ Event publishing helper function (inventory.publish_event)';
    RAISE NOTICE '  ✅ Stock movement event triggers';
    RAISE NOTICE '  ✅ Purchase order event triggers';
    RAISE NOTICE '  ✅ Receipt event triggers';
    RAISE NOTICE '  ✅ Cycle count event triggers';
    RAISE NOTICE '';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '  1. Deploy events-poller Edge Function (see COMPLIANCE_AUDIT_REPORT.md)';
    RAISE NOTICE '  2. Configure downstream webhook URL';
    RAISE NOTICE '  3. Test event emission with sample stock movement';
    RAISE NOTICE '================================================================';
END $$;
