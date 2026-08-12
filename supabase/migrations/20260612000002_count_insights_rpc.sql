-- Aggregation RPC backing the Count Schedule "Insights" tab: activity
-- heatmap, accuracy/adherence/coverage gauges, and the per-counter
-- leaderboard. One server-side rollup instead of shipping a year of count
-- lines to the browser.

CREATE OR REPLACE FUNCTION inventory.rpc_inv_count_insights(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'inventory', 'supply_chain', 'public'
AS $$
DECLARE
  v_heatmap   jsonb;
  v_totals    jsonb;
  v_users     jsonb;
  v_locations jsonb;
  v_adherence jsonb;
BEGIN
  -- Lines counted per day over the past 53 weeks (GitHub-style heatmap)
  SELECT coalesce(jsonb_agg(jsonb_build_object('date', d, 'value', n) ORDER BY d), '[]'::jsonb)
  INTO v_heatmap
  FROM (
    SELECT counted_at::date AS d, count(*) AS n
    FROM cycle_count_lines
    WHERE tenant_id = p_tenant_id
      AND counted_at IS NOT NULL
      AND counted_at >= now() - interval '371 days'
    GROUP BY 1
  ) t;

  -- Headline numbers. A line is "accurate" when it was counted and landed
  -- exactly on the expected quantity.
  SELECT jsonb_build_object(
    'counts_completed_90d', (
      SELECT count(*) FROM cycle_counts
      WHERE tenant_id = p_tenant_id
        AND status IN ('approved', 'posted', 'closed')
        AND coalesce(completed_at, posted_at, approved_at) >= now() - interval '90 days'
    ),
    'counts_completed_total', (
      SELECT count(*) FROM cycle_counts
      WHERE tenant_id = p_tenant_id AND status IN ('approved', 'posted', 'closed')
    ),
    'lines_counted_90d', (
      SELECT count(*) FROM cycle_count_lines
      WHERE tenant_id = p_tenant_id
        AND qty_counted IS NOT NULL
        AND counted_at >= now() - interval '90 days'
    ),
    'lines_counted_365d', (
      SELECT count(*) FROM cycle_count_lines
      WHERE tenant_id = p_tenant_id
        AND qty_counted IS NOT NULL
        AND counted_at >= now() - interval '365 days'
    ),
    'accuracy_pct_90d', (
      SELECT round(100.0 * count(*) FILTER (WHERE abs(coalesce(variance, 0)) < 0.0001) / nullif(count(*), 0), 1)
      FROM cycle_count_lines
      WHERE tenant_id = p_tenant_id
        AND qty_counted IS NOT NULL
        AND counted_at >= now() - interval '90 days'
    )
  ) INTO v_totals;

  -- Schedule adherence: of entries whose date has passed, how many turned
  -- into counts vs were skipped vs are sitting overdue.
  SELECT jsonb_build_object(
    'done',    count(*) FILTER (WHERE status IN ('generated', 'completed')),
    'skipped', count(*) FILTER (WHERE status = 'skipped'),
    'overdue', count(*) FILTER (WHERE status = 'planned' AND scheduled_date < CURRENT_DATE),
    'upcoming_30d', (
      SELECT count(*) FROM cycle_count_schedule
      WHERE tenant_id = p_tenant_id AND status = 'planned'
        AND scheduled_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
    )
  )
  INTO v_adherence
  FROM cycle_count_schedule
  WHERE tenant_id = p_tenant_id AND scheduled_date < CURRENT_DATE;

  -- Per-counter stats for the leaderboard (last 365 days). Line credit goes
  -- to the line's counter, falling back to the count's owner.
  SELECT coalesce(jsonb_agg(row_to_json(u)), '[]'::jsonb)
  INTO v_users
  FROM (
    SELECT
      coalesce(l.counted_by_user_id, c.counted_by_user_id) AS user_id,
      count(*) AS lines_counted,
      count(*) FILTER (WHERE abs(coalesce(l.variance, 0)) < 0.0001) AS accurate_lines,
      count(DISTINCT c.id) FILTER (WHERE c.status IN ('approved', 'posted', 'closed')) AS counts_completed
    FROM cycle_count_lines l
    JOIN cycle_counts c ON c.id = l.cycle_count_id
    WHERE l.tenant_id = p_tenant_id
      AND l.qty_counted IS NOT NULL
      AND l.counted_at >= now() - interval '365 days'
      AND coalesce(l.counted_by_user_id, c.counted_by_user_id) IS NOT NULL
    GROUP BY 1
    ORDER BY count(*) DESC
    LIMIT 25
  ) u;

  -- Location freshness: when was each active location last fully counted
  SELECT coalesce(jsonb_agg(row_to_json(loc) ORDER BY loc.last_counted_at ASC NULLS FIRST), '[]'::jsonb)
  INTO v_locations
  FROM (
    SELECT
      lo.id,
      lo.name,
      max(coalesce(c.completed_at, c.posted_at)) AS last_counted_at
    FROM locations lo
    LEFT JOIN cycle_counts c
      ON c.location_id = lo.id
      AND c.tenant_id = p_tenant_id
      AND c.status IN ('approved', 'posted', 'closed')
    WHERE lo.tenant_id = p_tenant_id
    GROUP BY lo.id, lo.name
    LIMIT 100
  ) loc;

  RETURN jsonb_build_object(
    'heatmap', v_heatmap,
    'totals', v_totals,
    'adherence', v_adherence,
    'users', v_users,
    'locations', v_locations
  );
END;
$$;

GRANT EXECUTE ON FUNCTION inventory.rpc_inv_count_insights(uuid) TO service_role;
