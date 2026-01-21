-- Migration: Create Reorder Point Alert System
-- Purpose: Automated alerts when stock falls below reorder points
-- Phase: 3 (Long-term strategic features)

SET search_path TO inventory, public;

-- ============================================================================
-- 1. Create reorder_alerts table
-- ============================================================================
CREATE TABLE IF NOT EXISTS inventory.reorder_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  catalog_item_id UUID NOT NULL REFERENCES inventory.catalog_items(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES inventory.locations(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('below_reorder', 'below_min', 'stockout', 'excess')),
  current_qty NUMERIC(18,4) NOT NULL,
  reorder_point NUMERIC(18,4),
  min_stock_level NUMERIC(18,4),
  target_level NUMERIC(18,4),
  suggested_order_qty NUMERIC(18,4),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'ordered', 'dismissed')),
  acknowledged_by UUID REFERENCES auth.users(id),
  acknowledged_at TIMESTAMPTZ,
  dismissed_by UUID REFERENCES auth.users(id),
  dismissed_at TIMESTAMPTZ,
  dismissed_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id)
);

-- Indexes
CREATE INDEX idx_reorder_alerts_tenant_status ON inventory.reorder_alerts(tenant_id, status);
CREATE INDEX idx_reorder_alerts_catalog_item ON inventory.reorder_alerts(catalog_item_id);
CREATE INDEX idx_reorder_alerts_location ON inventory.reorder_alerts(location_id);
CREATE INDEX idx_reorder_alerts_priority ON inventory.reorder_alerts(tenant_id, priority, status);
CREATE INDEX idx_reorder_alerts_created_at ON inventory.reorder_alerts(tenant_id, created_at DESC);

-- RLS policies
ALTER TABLE inventory.reorder_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY reorder_alerts_tenant_isolation ON inventory.reorder_alerts
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY reorder_alerts_service_role ON inventory.reorder_alerts
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Triggers
CREATE TRIGGER set_reorder_alerts_audit
  BEFORE INSERT OR UPDATE ON inventory.reorder_alerts
  FOR EACH ROW
  EXECUTE FUNCTION inventory.set_audit_fields();

CREATE TRIGGER update_reorder_alerts_updated_at
  BEFORE UPDATE ON inventory.reorder_alerts
  FOR EACH ROW
  EXECUTE FUNCTION inventory.update_updated_at_column();

-- ============================================================================
-- 2. Create view for items needing reorder
-- ============================================================================
CREATE OR REPLACE VIEW inventory.v_items_needing_reorder AS
SELECT
  sb.tenant_id,
  sb.catalog_item_id,
  sb.location_id,
  ci.sku,
  ci.name AS item_name,
  l.name AS location_name,
  sb.qty_on_hand,
  sb.qty_reserved,
  sb.qty_available,
  COALESCE(oo.qty_on_order, 0) AS qty_on_order,
  sb.qty_available + COALESCE(oo.qty_on_order, 0) AS inventory_position,
  COALESCE(ilp.reorder_point, ci.reorder_point, 0) AS reorder_point,
  COALESCE(ilp.min_qty, ci.min_stock_level, 0) AS min_stock_level,
  COALESCE(ilp.max_qty, ci.target_level, 0) AS target_level,
  COALESCE(ci.reorder_qty, 0) AS reorder_qty,
  ci.lead_time_days,
  ci.preferred_vendor_id,
  CASE
    WHEN sb.qty_available <= 0 THEN 'critical'
    WHEN sb.qty_available + COALESCE(oo.qty_on_order, 0) <= COALESCE(ilp.min_qty, ci.min_stock_level, 0) THEN 'high'
    WHEN sb.qty_available + COALESCE(oo.qty_on_order, 0) <= COALESCE(ilp.reorder_point, ci.reorder_point, 0) THEN 'medium'
    ELSE 'low'
  END AS alert_priority,
  CASE
    WHEN sb.qty_available <= 0 THEN 'stockout'
    WHEN sb.qty_available + COALESCE(oo.qty_on_order, 0) <= COALESCE(ilp.min_qty, ci.min_stock_level, 0) THEN 'below_min'
    WHEN sb.qty_available + COALESCE(oo.qty_on_order, 0) <= COALESCE(ilp.reorder_point, ci.reorder_point, 0) THEN 'below_reorder'
    ELSE NULL
  END AS alert_type,
  GREATEST(
    COALESCE(ilp.max_qty, ci.target_level, 0) - (sb.qty_available + COALESCE(oo.qty_on_order, 0)),
    COALESCE(ci.reorder_qty, 0)
  ) AS suggested_order_qty
FROM inventory.stock_balances sb
JOIN inventory.catalog_items ci ON ci.id = sb.catalog_item_id
JOIN inventory.locations l ON l.id = sb.location_id
LEFT JOIN inventory.item_location_par_levels ilp 
  ON ilp.catalog_item_id = sb.catalog_item_id 
  AND ilp.location_id = sb.location_id
LEFT JOIN inventory.v_on_order_by_item_location oo
  ON oo.catalog_item_id = sb.catalog_item_id
  AND oo.location_id = sb.location_id
WHERE ci.active = true
  AND ci.tracking_mode IN ('stock', 'both')
  AND (
    sb.qty_available + COALESCE(oo.qty_on_order, 0) <= COALESCE(ilp.reorder_point, ci.reorder_point, 0)
    OR sb.qty_available <= 0
  );

COMMENT ON VIEW inventory.v_items_needing_reorder IS 
  'Shows items that have fallen below reorder points or are stocked out. Includes suggested order quantities.';

-- ============================================================================
-- 3. Create function to generate/update reorder alerts
-- ============================================================================
CREATE OR REPLACE FUNCTION inventory.generate_reorder_alerts()
RETURNS TABLE (
  alerts_created INTEGER,
  alerts_updated INTEGER,
  alerts_auto_dismissed INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_alerts_created INTEGER := 0;
  v_alerts_updated INTEGER := 0;
  v_alerts_dismissed INTEGER := 0;
  v_item RECORD;
  v_existing_alert_id UUID;
BEGIN
  -- Loop through items needing reorder
  FOR v_item IN 
    SELECT * FROM inventory.v_items_needing_reorder
  LOOP
    -- Check if alert already exists for this item/location
    SELECT id INTO v_existing_alert_id
    FROM inventory.reorder_alerts
    WHERE tenant_id = v_item.tenant_id
      AND catalog_item_id = v_item.catalog_item_id
      AND location_id = v_item.location_id
      AND status IN ('open', 'acknowledged')
    LIMIT 1;

    IF v_existing_alert_id IS NOT NULL THEN
      -- Update existing alert with current quantities
      UPDATE inventory.reorder_alerts
      SET
        alert_type = v_item.alert_type,
        current_qty = v_item.qty_available,
        priority = v_item.alert_priority,
        suggested_order_qty = v_item.suggested_order_qty,
        updated_at = now()
      WHERE id = v_existing_alert_id;
      
      v_alerts_updated := v_alerts_updated + 1;
    ELSE
      -- Create new alert
      INSERT INTO inventory.reorder_alerts (
        tenant_id,
        catalog_item_id,
        location_id,
        alert_type,
        current_qty,
        reorder_point,
        min_stock_level,
        target_level,
        suggested_order_qty,
        priority,
        status
      ) VALUES (
        v_item.tenant_id,
        v_item.catalog_item_id,
        v_item.location_id,
        v_item.alert_type,
        v_item.qty_available,
        v_item.reorder_point,
        v_item.min_stock_level,
        v_item.target_level,
        v_item.suggested_order_qty,
        v_item.alert_priority,
        'open'
      );
      
      v_alerts_created := v_alerts_created + 1;
    END IF;
  END LOOP;

  -- Auto-dismiss alerts for items that are now above reorder point
  WITH dismissed AS (
    UPDATE inventory.reorder_alerts ra
    SET 
      status = 'dismissed',
      dismissed_reason = 'Stock level restored above reorder point',
      dismissed_at = now(),
      updated_at = now()
    WHERE ra.status IN ('open', 'acknowledged')
      AND NOT EXISTS (
        SELECT 1 
        FROM inventory.v_items_needing_reorder inr
        WHERE inr.tenant_id = ra.tenant_id
          AND inr.catalog_item_id = ra.catalog_item_id
          AND inr.location_id = ra.location_id
      )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_alerts_dismissed FROM dismissed;

  RETURN QUERY SELECT v_alerts_created, v_alerts_updated, v_alerts_dismissed;
END;
$$;

COMMENT ON FUNCTION inventory.generate_reorder_alerts() IS 
  'Scans stock levels and generates/updates reorder alerts. Auto-dismisses resolved alerts. Run via cron every hour.';

-- ============================================================================
-- 4. Create RPC functions for alert management
-- ============================================================================
CREATE OR REPLACE FUNCTION inventory.rpc_acknowledge_alert(
  p_alert_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id UUID;
  v_user_id UUID;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  v_tenant_id := current_tenant_id();
  
  -- Update alert
  UPDATE inventory.reorder_alerts
  SET
    status = 'acknowledged',
    acknowledged_by = v_user_id,
    acknowledged_at = now(),
    updated_at = now()
  WHERE id = p_alert_id
    AND tenant_id = v_tenant_id
    AND status = 'open';
    
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Alert not found or already acknowledged';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION inventory.rpc_dismiss_alert(
  p_alert_id UUID,
  p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id UUID;
  v_user_id UUID;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  v_tenant_id := current_tenant_id();
  
  -- Update alert
  UPDATE inventory.reorder_alerts
  SET
    status = 'dismissed',
    dismissed_by = v_user_id,
    dismissed_at = now(),
    dismissed_reason = p_reason,
    updated_at = now()
  WHERE id = p_alert_id
    AND tenant_id = v_tenant_id
    AND status IN ('open', 'acknowledged');
    
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Alert not found or already dismissed';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION inventory.rpc_mark_alert_ordered(
  p_alert_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  v_tenant_id := current_tenant_id();
  
  -- Update alert
  UPDATE inventory.reorder_alerts
  SET
    status = 'ordered',
    updated_at = now()
  WHERE id = p_alert_id
    AND tenant_id = v_tenant_id
    AND status IN ('open', 'acknowledged');
    
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Alert not found or already processed';
  END IF;
END;
$$;

-- ============================================================================
-- Success confirmation
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Migration 20260120000084 completed successfully';
  RAISE NOTICE '✓ Created reorder_alerts table with RLS';
  RAISE NOTICE '✓ Created v_items_needing_reorder view';
  RAISE NOTICE '✓ Created generate_reorder_alerts() function';
  RAISE NOTICE '✓ Created RPC functions for alert management';
  RAISE NOTICE 'Next: Set up cron job to run generate_reorder_alerts() hourly';
END $$;
