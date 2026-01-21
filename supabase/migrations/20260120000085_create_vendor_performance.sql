-- Migration: Create Vendor Performance Analytics
-- Purpose: Track vendor performance metrics and emit events
-- Phase: 3 (Long-term strategic features)

SET search_path TO inventory, public;

-- ============================================================================
-- 1. Create vendor_performance_metrics table
-- ============================================================================
CREATE TABLE IF NOT EXISTS inventory.vendor_performance_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  vendor_id UUID NOT NULL REFERENCES inventory.vendors(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  
  -- Order metrics
  total_pos_count INTEGER NOT NULL DEFAULT 0,
  total_pos_value NUMERIC(18,2) NOT NULL DEFAULT 0,
  cancelled_pos_count INTEGER NOT NULL DEFAULT 0,
  cancelled_pos_value NUMERIC(18,2) NOT NULL DEFAULT 0,
  
  -- Delivery metrics
  on_time_deliveries INTEGER NOT NULL DEFAULT 0,
  late_deliveries INTEGER NOT NULL DEFAULT 0,
  avg_lead_time_days NUMERIC(10,2),
  
  -- Quality metrics
  total_items_received NUMERIC(18,4) NOT NULL DEFAULT 0,
  rejected_items NUMERIC(18,4) NOT NULL DEFAULT 0,
  defect_rate NUMERIC(5,4), -- Percentage as decimal (0.05 = 5%)
  
  -- Financial metrics
  total_amount_paid NUMERIC(18,2) NOT NULL DEFAULT 0,
  disputes_count INTEGER NOT NULL DEFAULT 0,
  disputes_value NUMERIC(18,2) NOT NULL DEFAULT 0,
  
  -- Calculated scores
  on_time_delivery_rate NUMERIC(5,4), -- Percentage as decimal
  quality_score NUMERIC(5,4), -- 1.0 = perfect
  overall_rating NUMERIC(3,2), -- 1-5 star rating
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_event_id TEXT
);

-- Indexes
CREATE INDEX idx_vendor_performance_vendor ON inventory.vendor_performance_metrics(vendor_id, period_end DESC);
CREATE INDEX idx_vendor_performance_tenant_period ON inventory.vendor_performance_metrics(tenant_id, period_end DESC);
CREATE INDEX idx_vendor_performance_rating ON inventory.vendor_performance_metrics(tenant_id, overall_rating DESC);

-- RLS policies
ALTER TABLE inventory.vendor_performance_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY vendor_performance_metrics_tenant_isolation ON inventory.vendor_performance_metrics
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY vendor_performance_metrics_service_role ON inventory.vendor_performance_metrics
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Triggers
CREATE TRIGGER update_vendor_performance_metrics_updated_at
  BEFORE UPDATE ON inventory.vendor_performance_metrics
  FOR EACH ROW
  EXECUTE FUNCTION inventory.update_updated_at_column();

-- ============================================================================
-- 2. Create vendor_performance_events table for event sourcing
-- ============================================================================
CREATE TABLE IF NOT EXISTS inventory.vendor_performance_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  vendor_id UUID NOT NULL REFERENCES inventory.vendors(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'po_created',
    'po_cancelled',
    'delivery_on_time',
    'delivery_late',
    'items_received',
    'items_rejected',
    'invoice_paid',
    'dispute_raised',
    'quality_issue_reported'
  )),
  event_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Context
  po_id UUID REFERENCES inventory.purchase_orders(id),
  receipt_id UUID REFERENCES inventory.receipts(id),
  
  -- Metrics
  quantity NUMERIC(18,4),
  amount NUMERIC(18,2),
  days_late INTEGER,
  expected_date DATE,
  actual_date DATE,
  
  -- Event metadata
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

-- Indexes
CREATE INDEX idx_vendor_perf_events_vendor ON inventory.vendor_performance_events(vendor_id, event_date DESC);
CREATE INDEX idx_vendor_perf_events_type ON inventory.vendor_performance_events(tenant_id, event_type, event_date DESC);
CREATE INDEX idx_vendor_perf_events_po ON inventory.vendor_performance_events(po_id) WHERE po_id IS NOT NULL;

-- RLS policies
ALTER TABLE inventory.vendor_performance_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY vendor_performance_events_tenant_isolation ON inventory.vendor_performance_events
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY vendor_performance_events_service_role ON inventory.vendor_performance_events
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- 3. Create trigger to emit vendor performance events
-- ============================================================================
CREATE OR REPLACE FUNCTION inventory.emit_vendor_performance_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event_id UUID;
BEGIN
  -- Insert into events_outbox for external consumption
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
    NEW.event_type,
    'vendor_performance',
    NEW.vendor_id,
    jsonb_build_object(
      'vendor_id', NEW.vendor_id,
      'event_type', NEW.event_type,
      'event_date', NEW.event_date,
      'po_id', NEW.po_id,
      'receipt_id', NEW.receipt_id,
      'quantity', NEW.quantity,
      'amount', NEW.amount,
      'days_late', NEW.days_late,
      'metadata', NEW.metadata
    ),
    'pending'
  );
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_vendor_performance_events
  AFTER INSERT ON inventory.vendor_performance_events
  FOR EACH ROW
  EXECUTE FUNCTION inventory.emit_vendor_performance_event();

COMMENT ON FUNCTION inventory.emit_vendor_performance_event() IS 
  'Emits vendor performance events to events_outbox for external consumption';

-- ============================================================================
-- 4. Create function to record PO events
-- ============================================================================
CREATE OR REPLACE FUNCTION inventory.record_po_vendor_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Record PO creation
  IF TG_OP = 'INSERT' THEN
    INSERT INTO inventory.vendor_performance_events (
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
      NEW.vendor_id,
      'po_created',
      NEW.created_at,
      NEW.id,
      (SELECT SUM(qty_ordered * unit_cost) FROM inventory.purchase_order_lines WHERE po_id = NEW.id),
      jsonb_build_object('po_number', NEW.po_number, 'status', NEW.status)
    WHERE NEW.vendor_id IS NOT NULL;
    
  -- Record PO cancellation
  ELSIF TG_OP = 'UPDATE' AND OLD.status != 'cancelled' AND NEW.status = 'cancelled' THEN
    INSERT INTO inventory.vendor_performance_events (
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
      NEW.vendor_id,
      'po_cancelled',
      now(),
      NEW.id,
      (SELECT SUM(qty_ordered * unit_cost) FROM inventory.purchase_order_lines WHERE po_id = NEW.id),
      jsonb_build_object('po_number', NEW.po_number, 'cancelled_reason', NEW.notes)
    WHERE NEW.vendor_id IS NOT NULL;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Drop if exists and recreate trigger
DROP TRIGGER IF EXISTS track_po_vendor_performance ON inventory.purchase_orders;

CREATE TRIGGER track_po_vendor_performance
  AFTER INSERT OR UPDATE OF status ON inventory.purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION inventory.record_po_vendor_event();

-- ============================================================================
-- 5. Create function to record receipt/delivery events
-- ============================================================================
CREATE OR REPLACE FUNCTION inventory.record_receipt_vendor_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_vendor_id UUID;
  v_po_id UUID;
  v_expected_date DATE;
  v_days_late INTEGER;
  v_total_qty NUMERIC(18,4);
BEGIN
  -- Get PO details
  SELECT po.vendor_id, po.id, po.expected_delivery_date
  INTO v_vendor_id, v_po_id, v_expected_date
  FROM inventory.purchase_orders po
  WHERE po.id = NEW.po_id;
  
  IF v_vendor_id IS NULL THEN
    RETURN NEW;
  END IF;
  
  -- Calculate if late
  v_days_late := GREATEST(0, NEW.received_date::DATE - v_expected_date);
  
  -- Get total quantity received
  SELECT SUM(qty_received)
  INTO v_total_qty
  FROM inventory.receipt_lines
  WHERE receipt_id = NEW.id;
  
  -- Record delivery event
  INSERT INTO inventory.vendor_performance_events (
    tenant_id,
    vendor_id,
    event_type,
    event_date,
    po_id,
    receipt_id,
    quantity,
    days_late,
    expected_date,
    actual_date,
    metadata
  ) VALUES (
    NEW.tenant_id,
    v_vendor_id,
    CASE WHEN v_days_late > 0 THEN 'delivery_late' ELSE 'delivery_on_time' END,
    NEW.received_date,
    v_po_id,
    NEW.id,
    v_total_qty,
    v_days_late,
    v_expected_date,
    NEW.received_date::DATE,
    jsonb_build_object('receipt_number', NEW.receipt_number)
  );
  
  -- Record items received
  INSERT INTO inventory.vendor_performance_events (
    tenant_id,
    vendor_id,
    event_type,
    event_date,
    po_id,
    receipt_id,
    quantity,
    metadata
  ) VALUES (
    NEW.tenant_id,
    v_vendor_id,
    'items_received',
    NEW.received_date,
    v_po_id,
    NEW.id,
    v_total_qty,
    jsonb_build_object('receipt_number', NEW.receipt_number)
  );
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS track_receipt_vendor_performance ON inventory.receipts;

CREATE TRIGGER track_receipt_vendor_performance
  AFTER INSERT ON inventory.receipts
  FOR EACH ROW
  EXECUTE FUNCTION inventory.record_receipt_vendor_event();

-- ============================================================================
-- 6. Create view for vendor performance summary
-- ============================================================================
CREATE OR REPLACE VIEW inventory.v_vendor_performance_summary AS
WITH recent_period AS (
  SELECT
    vendor_id,
    tenant_id,
    COUNT(*) FILTER (WHERE event_type = 'po_created') AS pos_created_90d,
    SUM(amount) FILTER (WHERE event_type = 'po_created') AS total_spend_90d,
    COUNT(*) FILTER (WHERE event_type = 'delivery_on_time') AS on_time_count,
    COUNT(*) FILTER (WHERE event_type = 'delivery_late') AS late_count,
    AVG(days_late) FILTER (WHERE event_type = 'delivery_late' AND days_late > 0) AS avg_days_late,
    SUM(quantity) FILTER (WHERE event_type = 'items_received') AS total_items_received,
    SUM(quantity) FILTER (WHERE event_type = 'items_rejected') AS total_items_rejected,
    COUNT(*) FILTER (WHERE event_type = 'dispute_raised') AS disputes_count
  FROM inventory.vendor_performance_events
  WHERE event_date >= CURRENT_DATE - INTERVAL '90 days'
  GROUP BY vendor_id, tenant_id
)
SELECT
  v.id AS vendor_id,
  v.tenant_id,
  v.name AS vendor_name,
  v.code AS vendor_code,
  v.active AS is_active,
  
  -- Order metrics
  COALESCE(rp.pos_created_90d, 0) AS pos_last_90_days,
  COALESCE(rp.total_spend_90d, 0) AS spend_last_90_days,
  
  -- Delivery performance
  CASE 
    WHEN COALESCE(rp.on_time_count, 0) + COALESCE(rp.late_count, 0) > 0
    THEN ROUND(
      COALESCE(rp.on_time_count, 0)::NUMERIC / 
      (COALESCE(rp.on_time_count, 0) + COALESCE(rp.late_count, 0)), 
      4
    )
    ELSE NULL
  END AS on_time_delivery_rate,
  
  COALESCE(rp.avg_days_late, 0) AS avg_days_late,
  
  -- Quality metrics
  CASE 
    WHEN COALESCE(rp.total_items_received, 0) > 0
    THEN ROUND(
      1 - (COALESCE(rp.total_items_rejected, 0) / rp.total_items_received),
      4
    )
    ELSE NULL
  END AS quality_score,
  
  -- Issues
  COALESCE(rp.disputes_count, 0) AS disputes_last_90_days,
  
  -- Overall rating (1-5 stars)
  CASE
    WHEN COALESCE(rp.on_time_count, 0) + COALESCE(rp.late_count, 0) = 0 THEN NULL
    ELSE LEAST(5.0, GREATEST(1.0,
      -- Base 5 stars, subtract for issues
      5.0
      - (COALESCE(rp.late_count, 0)::NUMERIC / GREATEST(1, COALESCE(rp.on_time_count, 0) + COALESCE(rp.late_count, 0))) * 2  -- Late deliveries reduce up to 2 stars
      - (COALESCE(rp.total_items_rejected, 0) / GREATEST(1, COALESCE(rp.total_items_received, 1))) * 2  -- Quality issues reduce up to 2 stars
      - LEAST(1.0, COALESCE(rp.disputes_count, 0) * 0.5)  -- Disputes reduce up to 1 star
    ))
  END AS overall_rating

FROM inventory.vendors v
LEFT JOIN recent_period rp ON rp.vendor_id = v.id AND rp.tenant_id = v.tenant_id;

COMMENT ON VIEW inventory.v_vendor_performance_summary IS 
  'Vendor performance summary based on last 90 days of activity';

-- ============================================================================
-- 7. Create RPC function to calculate vendor metrics
-- ============================================================================
CREATE OR REPLACE FUNCTION inventory.rpc_calculate_vendor_metrics(
  p_start_date DATE DEFAULT CURRENT_DATE - INTERVAL '90 days',
  p_end_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  vendor_id UUID,
  vendor_name TEXT,
  overall_rating NUMERIC,
  on_time_rate NUMERIC,
  quality_score NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    vps.vendor_id,
    vps.vendor_name,
    vps.overall_rating,
    vps.on_time_delivery_rate,
    vps.quality_score
  FROM inventory.v_vendor_performance_summary vps
  WHERE vps.tenant_id = current_tenant_id()
    AND vps.pos_last_90_days > 0
  ORDER BY vps.overall_rating DESC NULLS LAST;
END;
$$;

-- ============================================================================
-- Success confirmation
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Migration 20260120000085 completed successfully';
  RAISE NOTICE '✓ Created vendor_performance_metrics table';
  RAISE NOTICE '✓ Created vendor_performance_events table with event emission';
  RAISE NOTICE '✓ Added triggers on purchase_orders and receipts to track performance';
  RAISE NOTICE '✓ Created v_vendor_performance_summary view';
  RAISE NOTICE '✓ Events will be emitted to events_outbox for external consumption';
END $$;
