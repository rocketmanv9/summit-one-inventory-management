-- ============================================================================
-- PHASE 8: VERIFICATION VIEWS
-- ============================================================================
-- System health and integrity monitoring

-- Ledger-to-Balance Reconciliation
CREATE OR REPLACE VIEW inventory.v_ledger_balance_reconciliation AS
WITH ledger_totals AS (
    SELECT 
        tenant_id,
        catalog_item_id,
        location_id,
        SUM(quantity_delta) as ledger_qty
    FROM inventory.stock_movements
    GROUP BY tenant_id, catalog_item_id, location_id
)
SELECT 
    COALESCE(lt.tenant_id, sb.tenant_id) as tenant_id,
    COALESCE(lt.catalog_item_id, sb.catalog_item_id) as catalog_item_id,
    ci.sku,
    ci.name as item_name,
    COALESCE(lt.location_id, sb.location_id) as location_id,
    l.name as location_name,
    COALESCE(lt.ledger_qty, 0) as ledger_qty,
    COALESCE(sb.qty_on_hand, 0) as balance_qty,
    COALESCE(lt.ledger_qty, 0) - COALESCE(sb.qty_on_hand, 0) as variance,
    CASE 
        WHEN COALESCE(lt.ledger_qty, 0) = COALESCE(sb.qty_on_hand, 0) THEN 'OK'
        ELSE 'MISMATCH'
    END as status
FROM ledger_totals lt
FULL OUTER JOIN inventory.stock_balances sb 
    ON sb.tenant_id = lt.tenant_id
    AND sb.catalog_item_id = lt.catalog_item_id
    AND sb.location_id = lt.location_id
LEFT JOIN inventory.catalog_items ci ON ci.id = COALESCE(lt.catalog_item_id, sb.catalog_item_id)
LEFT JOIN inventory.locations l ON l.id = COALESCE(lt.location_id, sb.location_id)
WHERE COALESCE(lt.ledger_qty, 0) != COALESCE(sb.qty_on_hand, 0);

COMMENT ON VIEW inventory.v_ledger_balance_reconciliation IS 
    'Identifies mismatches between ledger and balance tables';

-- Reservation Integrity Check
CREATE OR REPLACE VIEW inventory.v_reservation_integrity AS
WITH reservation_totals AS (
    SELECT 
        tenant_id,
        catalog_item_id,
        location_id,
        SUM(qty) as total_reserved
    FROM inventory.reservations
    WHERE status = 'active'
    GROUP BY tenant_id, catalog_item_id, location_id
)
SELECT 
    rt.tenant_id,
    rt.catalog_item_id,
    ci.sku,
    ci.name as item_name,
    rt.location_id,
    l.name as location_name,
    rt.total_reserved as calculated_reserved,
    sb.qty_reserved as balance_reserved,
    sb.qty_on_hand,
    rt.total_reserved - COALESCE(sb.qty_reserved, 0) as variance,
    CASE 
        WHEN rt.total_reserved > sb.qty_on_hand THEN 'OVER_RESERVED'
        WHEN rt.total_reserved != COALESCE(sb.qty_reserved, 0) THEN 'MISMATCH'
        ELSE 'OK'
    END as status
FROM reservation_totals rt
LEFT JOIN inventory.stock_balances sb 
    ON sb.tenant_id = rt.tenant_id
    AND sb.catalog_item_id = rt.catalog_item_id
    AND sb.location_id = rt.location_id
LEFT JOIN inventory.catalog_items ci ON ci.id = rt.catalog_item_id
LEFT JOIN inventory.locations l ON l.id = rt.location_id
WHERE rt.total_reserved > COALESCE(sb.qty_on_hand, 0)
   OR rt.total_reserved != COALESCE(sb.qty_reserved, 0);

COMMENT ON VIEW inventory.v_reservation_integrity IS 
    'Identifies reservation integrity issues (over-reserved or mismatched)';

-- Event Emission Check (Outbox Monitoring)
CREATE OR REPLACE VIEW inventory.v_events_pending AS
SELECT 
    eo.id,
    eo.tenant_id,
    eo.event_type,
    eo.status,
    eo.created_at,
    EXTRACT(EPOCH FROM (NOW() - eo.created_at)) as age_seconds,
    CASE 
        WHEN EXTRACT(EPOCH FROM (NOW() - eo.created_at)) > 300 THEN 'STUCK'
        WHEN EXTRACT(EPOCH FROM (NOW() - eo.created_at)) > 60 THEN 'DELAYED'
        ELSE 'OK'
    END as check_status
FROM public.events_outbox eo
WHERE eo.published_at IS NULL
ORDER BY eo.created_at ASC;

COMMENT ON VIEW inventory.v_events_pending IS 
    'Monitors outbox for stuck/delayed events (>60s = delayed, >300s = stuck)';

-- Idempotency Coverage Report
CREATE OR REPLACE VIEW inventory.v_idempotency_summary AS
SELECT 
    'purchase_order_lines' as table_name,
    COUNT(*) as total_rows,
    COUNT(last_event_id) as rows_with_event_id,
    COUNT(*) - COUNT(last_event_id) as rows_missing_event_id,
    ROUND(100.0 * COUNT(last_event_id) / NULLIF(COUNT(*), 0), 2) as coverage_pct
FROM inventory.purchase_order_lines
UNION ALL
SELECT 
    'cycle_counts',
    COUNT(*),
    COUNT(last_event_id),
    COUNT(*) - COUNT(last_event_id),
    ROUND(100.0 * COUNT(last_event_id) / NULLIF(COUNT(*), 0), 2)
FROM inventory.cycle_counts
UNION ALL
SELECT 
    'cycle_count_lines',
    COUNT(*),
    COUNT(last_event_id),
    COUNT(*) - COUNT(last_event_id),
    ROUND(100.0 * COUNT(last_event_id) / NULLIF(COUNT(*), 0), 2)
FROM inventory.cycle_count_lines
UNION ALL
SELECT 
    'transfers',
    COUNT(*),
    COUNT(last_event_id),
    COUNT(*) - COUNT(last_event_id),
    ROUND(100.0 * COUNT(last_event_id) / NULLIF(COUNT(*), 0), 2)
FROM inventory.transfers
UNION ALL
SELECT 
    'asset_assignments',
    COUNT(*),
    COUNT(last_event_id),
    COUNT(*) - COUNT(last_event_id),
    ROUND(100.0 * COUNT(last_event_id) / NULLIF(COUNT(*), 0), 2)
FROM inventory.asset_assignments
UNION ALL
SELECT 
    'reservations',
    COUNT(*),
    COUNT(last_event_id),
    COUNT(*) - COUNT(last_event_id),
    ROUND(100.0 * COUNT(last_event_id) / NULLIF(COUNT(*), 0), 2)
FROM inventory.reservations;

COMMENT ON VIEW inventory.v_idempotency_summary IS 
    'Tracks last_event_id coverage across all tables requiring idempotency';

-- RLS Policy Coverage
CREATE OR REPLACE VIEW inventory.v_rls_coverage AS
SELECT 
    schemaname,
    tablename,
    rowsecurity as rls_enabled,
    (SELECT COUNT(*) 
     FROM pg_policies 
     WHERE schemaname = pt.schemaname 
     AND tablename = pt.tablename) as policy_count
FROM pg_tables pt
WHERE schemaname = 'inventory'
ORDER BY rls_enabled DESC, tablename;

COMMENT ON VIEW inventory.v_rls_coverage IS 
    'Shows RLS status and policy count for all inventory tables';

DO $$ BEGIN
    RAISE NOTICE '✅ Verification views created';
END $$;

