-- 20260723000001_item_metrics_rollup.sql
-- Item metrics daily rollup (Grant, 2026-07-23).
--
-- inventory.daily_item_activity existed but nothing ever populated it, so the
-- new Metrics page (/inventory/metrics) had no history to graph. This adds:
--   1. a `spend` column (received qty x unit_cost) so we can chart purchasing $
--   2. fn_rollup_daily_item_activity(p_days) — idempotent upsert of daily
--      per-item/per-location aggregates from posted stock_movements
--   3. a nightly pg_cron job (3-day window absorbs late/backdated postings)
--   4. a one-time 2-year backfill so charts work immediately
--
-- Buckets mirror mv_item_velocity's semantics: 'issued'/'consumed' count as
-- usage, transfers tracked both directions, everything is net_change.

ALTER TABLE inventory.daily_item_activity
    ADD COLUMN IF NOT EXISTS spend numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN inventory.daily_item_activity.spend IS
    'Purchasing spend for the day: sum(quantity_delta * unit_cost) over received movements.';

CREATE OR REPLACE FUNCTION inventory.fn_rollup_daily_item_activity(p_days integer DEFAULT 3)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'inventory', 'public'
AS $$
DECLARE
    v_rows integer;
BEGIN
    -- net_change is a GENERATED column (received + adjusted + in - issued - out),
    -- so it is deliberately absent from the column list.
    INSERT INTO inventory.daily_item_activity AS d (
        id, tenant_id, activity_date, catalog_item_id, location_id,
        qty_received, qty_issued, qty_adjusted,
        qty_transferred_in, qty_transferred_out, spend, updated_at
    )
    SELECT
        gen_random_uuid(),
        sm.tenant_id,
        (sm.occurred_at AT TIME ZONE 'UTC')::date,
        sm.catalog_item_id,
        sm.location_id,
        COALESCE(sum(sm.quantity_delta)      FILTER (WHERE sm.movement_type = 'received'), 0),
        COALESCE(sum(abs(sm.quantity_delta)) FILTER (WHERE sm.movement_type IN ('issued', 'consumed')), 0),
        COALESCE(sum(sm.quantity_delta)      FILTER (WHERE sm.movement_type IN ('adjusted', 'adjustment')), 0),
        COALESCE(sum(sm.quantity_delta)      FILTER (WHERE sm.movement_type = 'transferred_in'), 0),
        COALESCE(sum(abs(sm.quantity_delta)) FILTER (WHERE sm.movement_type = 'transferred_out'), 0),
        COALESCE(sum(sm.quantity_delta * COALESCE(sm.unit_cost, 0))
                 FILTER (WHERE sm.movement_type = 'received'), 0),
        now()
    FROM inventory.stock_movements sm
    WHERE sm.posting_status = 'posted'
      AND sm.catalog_item_id IS NOT NULL
      AND sm.location_id IS NOT NULL
      AND sm.occurred_at >= now() - make_interval(days => p_days)
    GROUP BY sm.tenant_id, (sm.occurred_at AT TIME ZONE 'UTC')::date,
             sm.catalog_item_id, sm.location_id
    ON CONFLICT (tenant_id, activity_date, catalog_item_id, location_id)
    DO UPDATE SET
        qty_received        = EXCLUDED.qty_received,
        qty_issued          = EXCLUDED.qty_issued,
        qty_adjusted        = EXCLUDED.qty_adjusted,
        qty_transferred_in  = EXCLUDED.qty_transferred_in,
        qty_transferred_out = EXCLUDED.qty_transferred_out,
        spend               = EXCLUDED.spend,
        updated_at          = now();

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

COMMENT ON FUNCTION inventory.fn_rollup_daily_item_activity(integer) IS
    'Upserts daily per-item/location activity aggregates from posted stock_movements '
    'for the trailing p_days window. Idempotent; nightly cron re-rolls a 3-day window '
    'to absorb late postings.';

-- Nightly at 08:20 UTC (after the day fully closes in US time zones).
-- cron.schedule upserts by jobname, so re-running this migration is safe.
SELECT cron.schedule(
    'rollup_daily_item_activity',
    '20 8 * * *',
    $$SELECT inventory.fn_rollup_daily_item_activity(3)$$
);

-- One-time backfill: two years of history.
SELECT inventory.fn_rollup_daily_item_activity(730);
