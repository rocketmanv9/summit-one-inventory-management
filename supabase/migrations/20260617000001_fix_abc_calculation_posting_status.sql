-- Fix: rpc_calculate_abc_classification referenced a non-existent column.
-- stock_movements has `posting_status` ('posted'|'reversed'|'pending'), not
-- `movement_state = 'confirmed'`. The bad predicate made the RPC error at
-- runtime, so ABC "Recalculate" never worked. Only that one line changes.

CREATE OR REPLACE FUNCTION "inventory"."rpc_calculate_abc_classification"(
  "p_start_date" "date" DEFAULT (CURRENT_DATE - '365 days'::interval),
  "p_end_date" "date" DEFAULT CURRENT_DATE,
  "p_method" "text" DEFAULT 'value'::"text"
) RETURNS TABLE("items_classified" integer, "class_a_count" integer, "class_b_count" integer, "class_c_count" integer, "class_d_count" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_tenant_id UUID;
  v_items_classified INTEGER := 0;
  v_class_a INTEGER := 0;
  v_class_b INTEGER := 0;
  v_class_c INTEGER := 0;
  v_class_d INTEGER := 0;
BEGIN
  v_tenant_id := current_tenant_id();

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
      AND sm.posting_status = 'posted'   -- was: sm.movement_state = 'confirmed'
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
