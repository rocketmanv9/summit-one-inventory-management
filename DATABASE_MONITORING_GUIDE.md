# Database Monitoring & Maintenance Guide

## 🎯 Post-Migration Setup Tasks

After running migration `20260121000000_comprehensive_security_hardening.sql`, complete these setup tasks:

---

## 1. Configure Materialized View Refresh

### Option A: Using pg_cron (Recommended for Supabase)

```sql
-- Install pg_cron extension (if not already installed)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule materialized view refresh every 5 minutes
SELECT cron.schedule(
    'refresh-inventory-dashboards',
    '*/5 * * * *',
    'SELECT inventory.refresh_dashboard_views()'
);

-- Verify scheduled jobs
SELECT * FROM cron.job;
```

### Option B: Using External Scheduler

Create a cron job on your application server:

```bash
# Add to crontab: crontab -e
*/5 * * * * psql $DATABASE_URL -c "SELECT inventory.refresh_dashboard_views();"
```

### Option C: Using Supabase Edge Function

Create a scheduled edge function that calls:
```typescript
const { data, error } = await supabase.rpc('refresh_dashboard_views');
```

---

## 2. Set Up Event Monitoring Alerts

### Monitor Stuck Events

```sql
-- Query to run every 5 minutes
SELECT * FROM inventory.v_events_stuck 
WHERE health_status IN ('STUCK', 'DEAD_LETTER');
```

**Alert Thresholds:**
- ⚠️ WARNING: Any event older than 5 minutes
- 🚨 CRITICAL: Any event with `health_status = 'DEAD_LETTER'`
- 🚨 CRITICAL: Any event older than 1 hour

### Sample Alert Script

```typescript
// Run this every 5 minutes via cron or edge function
const { data: stuckEvents } = await supabase
  .from('v_events_stuck')
  .select('*')
  .in('health_status', ['STUCK', 'DEAD_LETTER']);

if (stuckEvents && stuckEvents.length > 0) {
  // Send alert via email/Slack/PagerDuty
  await sendAlert({
    severity: 'CRITICAL',
    message: `${stuckEvents.length} events stuck in outbox`,
    events: stuckEvents
  });
}
```

---

## 3. Performance Monitoring

### Weekly Query Review

Run this query every Monday to identify slow queries:

```sql
SELECT 
    query,
    calls,
    ROUND(mean_exec_time::numeric, 2) as avg_ms,
    ROUND(max_exec_time::numeric, 2) as max_ms,
    rows
FROM inventory.v_slow_queries
WHERE mean_exec_time > 100  -- Queries slower than 100ms
ORDER BY mean_exec_time DESC
LIMIT 20;
```

**Action Items:**
- Queries >100ms: Review and optimize
- Queries >500ms: Add indexes or refactor
- Queries >1000ms: Immediate attention required

### Table Bloat Monitoring

Run this query daily:

```sql
SELECT 
    tablename,
    total_size,
    dead_tuple_percent,
    last_vacuum,
    last_autovacuum
FROM inventory.v_table_bloat
WHERE dead_tuple_percent > 20  -- Alert threshold
ORDER BY dead_tuple_percent DESC;
```

**Action Items:**
- `dead_tuple_percent > 20%`: Consider manual VACUUM
- `dead_tuple_percent > 50%`: Run `VACUUM ANALYZE` immediately
- No recent vacuum: Check autovacuum settings

```sql
-- Manual vacuum if needed
VACUUM ANALYZE inventory.stock_movements;
VACUUM ANALYZE inventory.inventory_events;
```

---

## 4. Dashboard KPI Monitoring

### Check Materialized View Freshness

```sql
SELECT 
    'mv_inventory_summary' as view_name,
    refreshed_at,
    EXTRACT(EPOCH FROM (NOW() - refreshed_at))/60 as age_minutes
FROM inventory.mv_inventory_summary
LIMIT 1;
```

**Alert if:** `age_minutes > 10` (views should refresh every 5 minutes)

### Monitor Inventory Health

```sql
-- Check for negative balances (should never happen)
SELECT * FROM inventory.mv_inventory_summary
WHERE negative_balance_count > 0;

-- Alert if found - indicates data integrity issue
```

---

## 5. Data Integrity Checks

### Daily Reconciliation Check

```sql
-- Run this daily to verify ledger-to-balance accuracy
SELECT 
    status,
    COUNT(*) as count
FROM inventory.v_ledger_balance_reconciliation
GROUP BY status;

-- Expected: All rows should have status = 'OK'
-- If MISMATCH found, investigate immediately
```

### Weekly Reservation Integrity Check

```sql
-- Verify no over-reservations exist
SELECT 
    health_status,
    COUNT(*) as count
FROM inventory.v_reservation_integrity
GROUP BY health_status;

-- Expected: All rows should have status = 'OK'
-- If OVER_RESERVED or MISMATCH found, investigate
```

---

## 6. Capacity Planning

### Monitor Table Growth

```sql
SELECT 
    tablename,
    total_size,
    live_tuples
FROM inventory.v_table_bloat
WHERE schemaname = 'inventory'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
LIMIT 10;
```

**Partitioning Triggers:**
- `inventory_events`: Partition when >10M rows
- `stock_movements`: Partition when >10M rows
- `daily_item_activity`: Partition when >5M rows

### Example Partitioning Script (for future use)

```sql
-- When inventory_events exceeds 10M rows:
-- 1. Create new partitioned table
CREATE TABLE inventory.inventory_events_new (
    LIKE inventory.inventory_events INCLUDING ALL
) PARTITION BY RANGE (occurred_at);

-- 2. Create initial partitions
CREATE TABLE inventory.inventory_events_2026_01 
    PARTITION OF inventory.inventory_events_new
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

CREATE TABLE inventory.inventory_events_2026_02 
    PARTITION OF inventory.inventory_events_new
    FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');

-- 3. Migrate data (off-peak hours)
INSERT INTO inventory.inventory_events_new 
SELECT * FROM inventory.inventory_events;

-- 4. Swap tables (atomic)
BEGIN;
ALTER TABLE inventory.inventory_events RENAME TO inventory_events_old;
ALTER TABLE inventory.inventory_events_new RENAME TO inventory_events;
COMMIT;

-- 5. Drop old table after verification
DROP TABLE inventory.inventory_events_old;
```

---

## 7. Backup Verification

### Verify Point-in-Time Recovery (PITR)

```sql
-- Check last backup timestamp (Supabase auto-manages this)
SELECT 
    pg_last_wal_receive_lsn(),
    pg_last_wal_replay_lsn(),
    pg_last_xact_replay_timestamp();
```

### Test Recovery Process

**Monthly Task:** Perform a restore drill to non-production database

```bash
# Using Supabase CLI
supabase db dump --remote > backup.sql
supabase db reset --db-url=$STAGING_DB_URL
psql $STAGING_DB_URL < backup.sql
```

---

## 8. Security Audit Checklist

### Monthly Security Review

```sql
-- 1. Verify RLS is enabled on all tables
SELECT 
    schemaname,
    tablename,
    rowsecurity
FROM pg_tables
WHERE schemaname = 'inventory'
  AND rowsecurity = false;
-- Expected: 0 rows (all tables should have RLS enabled)

-- 2. Verify service_role policies exist
SELECT 
    tablename,
    COUNT(*) as policy_count
FROM pg_policies
WHERE schemaname = 'inventory'
  AND policyname LIKE '%service_role%'
GROUP BY tablename
ORDER BY tablename;
-- Expected: All critical tables should have service_role policy

-- 3. Check for unexpected privileges
SELECT 
    grantee,
    table_schema,
    table_name,
    privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'inventory'
  AND grantee NOT IN ('authenticated', 'service_role', 'postgres')
ORDER BY grantee, table_name;
-- Expected: 0 rows (no unexpected grants)
```

---

## 9. Incident Response Procedures

### Stuck Events in Outbox

```sql
-- 1. Identify stuck events
SELECT * FROM inventory.v_events_stuck 
WHERE health_status = 'STUCK';

-- 2. Check error messages
SELECT id, event_type, error_message, retry_count
FROM inventory.events_outbox
WHERE retry_count >= 3;

-- 3. Manual retry (if transient error)
UPDATE inventory.events_outbox
SET retry_count = 0, last_retry_at = NULL, error_message = NULL
WHERE id = '<stuck-event-id>';

-- 4. Move to dead letter (if permanent error)
-- Log event details, then delete or mark as failed
UPDATE inventory.events_outbox
SET status = 'dead_letter'
WHERE id = '<permanently-failed-event-id>';
```

### Data Integrity Mismatch

```sql
-- 1. Identify mismatch
SELECT * FROM inventory.v_ledger_balance_reconciliation
WHERE status = 'MISMATCH';

-- 2. Rebuild affected stock_balances
SELECT inventory.rebuild_stock_balances_for_item(
    '<tenant-id>',
    '<catalog-item-id>',
    '<location-id>'
);

-- 3. Verify fix
SELECT * FROM inventory.v_ledger_balance_reconciliation
WHERE catalog_item_id = '<item-id>' AND location_id = '<location-id>';
```

### Over-Reservation Detected

```sql
-- 1. Identify issue
SELECT * FROM inventory.v_reservation_integrity
WHERE health_status = 'OVER_RESERVED';

-- 2. Cancel excessive reservations (oldest first)
UPDATE inventory.reservations
SET status = 'cancelled', updated_at = NOW()
WHERE id IN (
    SELECT r.id
    FROM inventory.reservations r
    JOIN inventory.v_reservation_integrity vi 
        ON vi.catalog_item_id = r.catalog_item_id
        AND vi.location_id = r.location_id
    WHERE vi.health_status = 'OVER_RESERVED'
    ORDER BY r.created_at DESC
    LIMIT 1
);

-- 3. Verify fix
SELECT * FROM inventory.v_reservation_integrity
WHERE catalog_item_id = '<item-id>' AND location_id = '<location-id>';
```

---

## 10. Performance Tuning

### Connection Pool Settings (pgBouncer)

```ini
[databases]
inventory_prod = host=db.supabase.co port=5432 dbname=postgres

[pgbouncer]
pool_mode = transaction
max_client_conn = 1000
default_pool_size = 25
reserve_pool_size = 5
max_db_connections = 100
```

### Recommended PostgreSQL Settings

```sql
-- For write-heavy workloads
ALTER SYSTEM SET shared_buffers = '4GB';
ALTER SYSTEM SET effective_cache_size = '12GB';
ALTER SYSTEM SET maintenance_work_mem = '1GB';
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET wal_buffers = '16MB';
ALTER SYSTEM SET random_page_cost = 1.1;
ALTER SYSTEM SET effective_io_concurrency = 200;

-- Restart required after ALTER SYSTEM
```

---

## 📊 Sample Monitoring Dashboard Queries

### Real-Time Inventory Overview

```sql
SELECT 
    total_items,
    total_locations,
    total_qty_on_hand,
    total_qty_reserved,
    total_qty_available,
    negative_balance_count,
    zero_balance_count,
    refreshed_at
FROM inventory.mv_inventory_summary
WHERE tenant_id = '<tenant-id>';
```

### Low Stock Alerts

```sql
SELECT 
    sku,
    name,
    total_available,
    min_stock_level,
    reorder_point,
    location_count
FROM inventory.mv_low_stock_summary
WHERE tenant_id = '<tenant-id>'
ORDER BY total_available ASC
LIMIT 20;
```

### Asset Utilization

```sql
SELECT 
    asset_type,
    status,
    asset_count,
    currently_assigned,
    ROUND(100.0 * currently_assigned / NULLIF(asset_count, 0), 1) as utilization_pct
FROM inventory.mv_asset_utilization
WHERE tenant_id = '<tenant-id>'
ORDER BY asset_count DESC;
```

---

## 🚨 Alert Thresholds Summary

| Metric | Warning | Critical | Action |
|--------|---------|----------|--------|
| Events stuck age | >5 min | >1 hour | Investigate outbox poller |
| Dead tuple % | >20% | >50% | Run VACUUM ANALYZE |
| Query avg time | >100ms | >1000ms | Optimize query/add index |
| Materialized view age | >10 min | >30 min | Check cron job |
| Negative balances | >0 | Any | Data integrity issue |
| Over-reservations | >0 | Any | Cancel excess reservations |
| Retry count | ≥3 | ≥5 | Move to dead letter |

---

## 📅 Maintenance Schedule

| Task | Frequency | Owner |
|------|-----------|-------|
| Review slow queries | Weekly | DBA/DevOps |
| Check table bloat | Daily | Automated |
| Verify backups | Daily | Automated |
| Security audit | Monthly | Security Team |
| Capacity planning | Monthly | DBA |
| Restore drill | Monthly | DevOps |
| Partition management | As needed | DBA |
| Materialized view refresh | Every 5 min | Automated |

---

## ✅ Success Criteria

Your database is healthy when:
- ✅ All materialized views refresh within 5 minutes
- ✅ No events stuck in outbox >1 hour
- ✅ Dead tuple percentage <20% on all tables
- ✅ No data integrity mismatches
- ✅ All queries <100ms average
- ✅ Zero negative balance counts
- ✅ Zero over-reservation issues
- ✅ RLS enabled on all tables

---

**Last Updated:** January 21, 2026  
**Migration Version:** 20260121000000_comprehensive_security_hardening.sql
