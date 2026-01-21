-- Migration: Create ABC Classification System
-- Purpose: Classify inventory items by value/usage for strategic inventory management
-- Phase: 3 (Long-term strategic features)

SET search_path TO inventory, public;

-- ============================================================================
-- 1. Create abc_classification table
-- ============================================================================
CREATE TABLE IF NOT EXISTS inventory.abc_classification (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  catalog_item_id UUID NOT NULL REFERENCES inventory.catalog_items(id) ON DELETE CASCADE,
  classification TEXT NOT NULL CHECK (classification IN ('A', 'B', 'C', 'D')),
  
  -- Analysis metrics
  annual_usage_qty NUMERIC(18,4) NOT NULL DEFAULT 0,
  annual_usage_value NUMERIC(18,2) NOT NULL DEFAULT 0,
  cumulative_value_pct NUMERIC(5,4), -- Percentage as decimal
  
  -- Classification criteria
  classification_method TEXT NOT NULL CHECK (classification_method IN ('value', 'usage', 'hybrid')),
  value_rank INTEGER,
  usage_rank INTEGER,
  
  -- Analysis period
  analysis_start_date DATE NOT NULL,
  analysis_end_date DATE NOT NULL,
  
  -- Metadata
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id)
);

-- Unique constraint: one classification per item per analysis period
CREATE UNIQUE INDEX idx_abc_class_item_period 
  ON inventory.abc_classification(tenant_id, catalog_item_id, analysis_end_date);

-- Indexes
CREATE INDEX idx_abc_class_tenant ON inventory.abc_classification(tenant_id, classification);
CREATE INDEX idx_abc_class_item ON inventory.abc_classification(catalog_item_id);
CREATE INDEX idx_abc_class_period ON inventory.abc_classification(tenant_id, analysis_end_date DESC);

-- RLS policies
ALTER TABLE inventory.abc_classification ENABLE ROW LEVEL SECURITY;

CREATE POLICY abc_classification_tenant_isolation ON inventory.abc_classification
  FOR ALL
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY abc_classification_service_role ON inventory.abc_classification
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Triggers
CREATE TRIGGER update_abc_classification_updated_at
  BEFORE UPDATE ON inventory.abc_classification
  FOR EACH ROW
  EXECUTE FUNCTION inventory.update_updated_at_column();

-- ============================================================================
-- 2. Create function to emit ABC classification events
-- ============================================================================
CREATE OR REPLACE FUNCTION inventory.emit_abc_classification_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Emit event when classification changes
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.classification != NEW.classification) THEN
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
        WHEN 'INSERT' THEN 'abc_classification_created'
        WHEN 'UPDATE' THEN 'abc_classification_changed'
      END,
      'catalog_item',
      NEW.catalog_item_id,
      jsonb_build_object(
        'catalog_item_id', NEW.catalog_item_id,
        'classification', NEW.classification,
        'old_classification', CASE WHEN TG_OP = 'UPDATE' THEN OLD.classification ELSE NULL END,
        'annual_usage_value', NEW.annual_usage_value,
        'cumulative_value_pct', NEW.cumulative_value_pct,
        'classification_method', NEW.classification_method,
        'analysis_period', jsonb_build_object(
          'start', NEW.analysis_start_date,
          'end', NEW.analysis_end_date
        )
      ),
      'pending'
    );
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_abc_classification_events
  AFTER INSERT OR UPDATE OF classification ON inventory.abc_classification
  FOR EACH ROW
  EXECUTE FUNCTION inventory.emit_abc_classification_event();

COMMENT ON FUNCTION inventory.emit_abc_classification_event() IS 
  'Emits ABC classification events to events_outbox when items are classified or reclassified';

-- ============================================================================
-- 3. Create function to calculate ABC classification
-- ============================================================================
CREATE OR REPLACE FUNCTION inventory.rpc_calculate_abc_classification(
  p_start_date DATE DEFAULT CURRENT_DATE - INTERVAL '365 days',
  p_end_date DATE DEFAULT CURRENT_DATE,
  p_method TEXT DEFAULT 'value' -- 'value', 'usage', or 'hybrid'
)
RETURNS TABLE (
  items_classified INTEGER,
  class_a_count INTEGER,
  class_b_count INTEGER,
  class_c_count INTEGER,
  class_d_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id UUID;
  v_total_value NUMERIC(18,2);
  v_items_classified INTEGER := 0;
  v_class_a INTEGER := 0;
  v_class_b INTEGER := 0;
  v_class_c INTEGER := 0;
  v_class_d INTEGER := 0;
BEGIN
  v_tenant_id := current_tenant_id();
  
  -- Calculate usage metrics for each item
  WITH item_usage AS (
    SELECT
      sm.catalog_item_id,
      SUM(ABS(sm.quantity_delta)) FILTER (WHERE sm.movement_type IN ('issued', 'consumed')) AS total_usage_qty,
      AVG(pol.unit_cost) AS avg_unit_cost
    FROM inventory.stock_movements sm
    LEFT JOIN inventory.receipt_lines rl ON rl.receipt_id::TEXT = sm.source_ref_id::TEXT AND sm.source_ref_type = 'receipt'
    LEFT JOIN inventory.purchase_order_lines pol ON pol.id = rl.po_line_id
    WHERE sm.tenant_id = v_tenant_id
      AND sm.created_at BETWEEN p_start_date AND p_end_date
      AND sm.movement_state = 'confirmed'
    GROUP BY sm.catalog_item_id
  ),
  item_metrics AS (
    SELECT
      iu.catalog_item_id,
      COALESCE(iu.total_usage_qty, 0) AS annual_usage_qty,
      COALESCE(iu.total_usage_qty, 0) * COALESCE(iu.avg_unit_cost, 0) AS annual_usage_value
    FROM item_usage iu
  ),
  ranked_items AS (
    SELECT
      catalog_item_id,
      annual_usage_qty,
      annual_usage_value,
      ROW_NUMBER() OVER (ORDER BY annual_usage_value DESC) AS value_rank,
      ROW_NUMBER() OVER (ORDER BY annual_usage_qty DESC) AS usage_rank,
      SUM(annual_usage_value) OVER (ORDER BY annual_usage_value DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cumulative_value,
      SUM(annual_usage_value) OVER () AS total_value
    FROM item_metrics
    WHERE annual_usage_value > 0
  ),
  classified_items AS (
    SELECT
      catalog_item_id,
      annual_usage_qty,
      annual_usage_value,
      cumulative_value / NULLIF(total_value, 0) AS cumulative_value_pct,
      value_rank,
      usage_rank,
      CASE
        WHEN p_method = 'value' THEN
          CASE
            WHEN cumulative_value / NULLIF(total_value, 0) <= 0.80 THEN 'A'
            WHEN cumulative_value / NULLIF(total_value, 0) <= 0.95 THEN 'B'
            ELSE 'C'
          END
        WHEN p_method = 'usage' THEN
          CASE
            WHEN usage_rank <= (SELECT COUNT(*) * 0.20 FROM ranked_items) THEN 'A'
            WHEN usage_rank <= (SELECT COUNT(*) * 0.50 FROM ranked_items) THEN 'B'
            ELSE 'C'
          END
        ELSE -- hybrid
          CASE
            WHEN (cumulative_value / NULLIF(total_value, 0) <= 0.70 AND usage_rank <= (SELECT COUNT(*) * 0.30 FROM ranked_items)) THEN 'A'
            WHEN (cumulative_value / NULLIF(total_value, 0) <= 0.90 OR usage_rank <= (SELECT COUNT(*) * 0.60 FROM ranked_items)) THEN 'B'
            ELSE 'C'
          END
      END AS classification
    FROM ranked_items
  )
  -- Insert or update classifications
  INSERT INTO inventory.abc_classification (
    tenant_id,
    catalog_item_id,
    classification,
    annual_usage_qty,
    annual_usage_value,
    cumulative_value_pct,
    classification_method,
    value_rank,
    usage_rank,
    analysis_start_date,
    analysis_end_date
  )
  SELECT
    v_tenant_id,
    ci.catalog_item_id,
    ci.classification,
    ci.annual_usage_qty,
    ci.annual_usage_value,
    ci.cumulative_value_pct,
    p_method,
    ci.value_rank,
    ci.usage_rank,
    p_start_date,
    p_end_date
  FROM classified_items ci
  ON CONFLICT (tenant_id, catalog_item_id, analysis_end_date)
  DO UPDATE SET
    classification = EXCLUDED.classification,
    annual_usage_qty = EXCLUDED.annual_usage_qty,
    annual_usage_value = EXCLUDED.annual_usage_value,
    cumulative_value_pct = EXCLUDED.cumulative_value_pct,
    classification_method = EXCLUDED.classification_method,
    value_rank = EXCLUDED.value_rank,
    usage_rank = EXCLUDED.usage_rank,
    updated_at = now();
  
  -- Get classification counts
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE classification = 'A'),
    COUNT(*) FILTER (WHERE classification = 'B'),
    COUNT(*) FILTER (WHERE classification = 'C'),
    COUNT(*) FILTER (WHERE classification = 'D')
  INTO v_items_classified, v_class_a, v_class_b, v_class_c, v_class_d
  FROM inventory.abc_classification
  WHERE tenant_id = v_tenant_id
    AND analysis_end_date = p_end_date;
  
  RETURN QUERY SELECT v_items_classified, v_class_a, v_class_b, v_class_c, v_class_d;
END;
$$;

COMMENT ON FUNCTION inventory.rpc_calculate_abc_classification IS 
  'Calculates ABC classification for all items based on usage/value. A = top 80% value, B = next 15%, C = remaining 5%';

-- ============================================================================
-- 4. Create view for current ABC classification
-- ============================================================================
CREATE OR REPLACE VIEW inventory.v_current_abc_classification AS
WITH latest_analysis AS (
  SELECT DISTINCT ON (tenant_id, catalog_item_id)
    *
  FROM inventory.abc_classification
  ORDER BY tenant_id, catalog_item_id, analysis_end_date DESC
)
SELECT
  la.tenant_id,
  la.catalog_item_id,
  ci.sku,
  ci.name AS item_name,
  la.classification,
  la.annual_usage_qty,
  la.annual_usage_value,
  la.cumulative_value_pct,
  la.classification_method,
  la.value_rank,
  la.usage_rank,
  la.analysis_end_date,
  
  -- Recommended management strategy
  CASE la.classification
    WHEN 'A' THEN 'High priority: Tight control, frequent reviews, accurate forecasting'
    WHEN 'B' THEN 'Medium priority: Regular monitoring, standard controls'
    WHEN 'C' THEN 'Low priority: Simple controls, bulk ordering'
    WHEN 'D' THEN 'Very low: Consider discontinuation or consignment'
  END AS management_strategy,
  
  -- Recommended review frequency
  CASE la.classification
    WHEN 'A' THEN 'Weekly'
    WHEN 'B' THEN 'Monthly'
    WHEN 'C' THEN 'Quarterly'
    WHEN 'D' THEN 'Annually'
  END AS review_frequency

FROM latest_analysis la
JOIN inventory.catalog_items ci ON ci.id = la.catalog_item_id
WHERE ci.active = true;

COMMENT ON VIEW inventory.v_current_abc_classification IS 
  'Shows the most recent ABC classification for each active item with management recommendations';

-- ============================================================================
-- Success confirmation
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE 'Migration 20260120000087 completed successfully';
  RAISE NOTICE '✓ Created abc_classification table with event emission';
  RAISE NOTICE '✓ Created rpc_calculate_abc_classification function';
  RAISE NOTICE '✓ Created v_current_abc_classification view';
  RAISE NOTICE '✓ ABC classes: A (top 80%% value), B (15%%), C (5%%)';
  RAISE NOTICE '✓ Events: abc_classification_created, abc_classification_changed';
END $$;
