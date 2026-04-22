-- Test Script: Cycle Count Variance Handling
-- Run this to verify the complete variance workflow

-- Setup: Get tenant and location IDs
\echo '=== Test Setup ==='
SELECT 
  t.id as tenant_id,
  l.id as location_id,
  l.name as location_name
FROM core.tenants t
CROSS JOIN inventory.locations l
WHERE l.name ILIKE '%warehouse%' OR l.name ILIKE '%yard%'
LIMIT 1;

-- Note: Replace the UUIDs below with values from above query

-- Step 1: Create a test cycle count
\echo '=== Step 1: Create Cycle Count ==='
INSERT INTO inventory.cycle_counts (
  tenant_id,
  count_number,
  location_id,
  count_type,
  status,
  created_at
) VALUES (
  'YOUR_TENANT_ID'::uuid,
  'TEST-VARIANCE-001',
  'YOUR_LOCATION_ID'::uuid,
  'full',
  'draft',
  NOW()
) RETURNING id, count_number, status;

-- Step 2: Start the count (creates lines from stock_balances)
\echo '=== Step 2: Check Stock Balances (before) ==='
SELECT 
  sb.catalog_item_id,
  ci.name,
  ci.sku,
  sb.qty_on_hand,
  sb.location_id
FROM inventory.stock_balances sb
JOIN inventory.catalog_items ci ON ci.id = sb.catalog_item_id
WHERE sb.location_id = 'YOUR_LOCATION_ID'::uuid
  AND sb.qty_on_hand > 0
LIMIT 5;

-- Manually create test cycle count lines with variance
\echo '=== Step 3: Create Test Lines with Variance ==='
WITH test_items AS (
  SELECT 
    sb.catalog_item_id,
    sb.qty_on_hand,
    'YOUR_CYCLE_COUNT_ID'::uuid as cycle_count_id,
    'YOUR_TENANT_ID'::uuid as tenant_id,
    'YOUR_LOCATION_ID'::uuid as location_id
  FROM inventory.stock_balances sb
  WHERE sb.location_id = 'YOUR_LOCATION_ID'::uuid
    AND sb.qty_on_hand > 0
  LIMIT 3
)
INSERT INTO inventory.cycle_count_lines (
  tenant_id,
  cycle_count_id,
  line_number,
  catalog_item_id,
  location_id,
  qty_expected,
  qty_counted,
  variance,
  decision_status,
  created_at
)
SELECT 
  tenant_id,
  cycle_count_id,
  ROW_NUMBER() OVER () as line_number,
  catalog_item_id,
  location_id,
  qty_on_hand as qty_expected,
  CASE 
    WHEN ROW_NUMBER() OVER () = 1 THEN qty_on_hand - 5  -- Variance: -5
    WHEN ROW_NUMBER() OVER () = 2 THEN qty_on_hand + 3  -- Variance: +3
    ELSE qty_on_hand                                     -- Variance: 0
  END as qty_counted,
  CASE 
    WHEN ROW_NUMBER() OVER () = 1 THEN -5
    WHEN ROW_NUMBER() OVER () = 2 THEN 3
    ELSE 0
  END as variance,
  'pending',
  NOW()
FROM test_items
RETURNING id, line_number, qty_expected, qty_counted, variance;

-- Step 4: Update cycle count to under_review
\echo '=== Step 4: Move to Under Review ==='
UPDATE inventory.cycle_counts
SET 
  status = 'under_review',
  started_at = NOW(),
  snapshot_at = NOW(),
  completed_at = NOW()
WHERE id = 'YOUR_CYCLE_COUNT_ID'::uuid
RETURNING id, status;

-- Step 5: View variance lines (before decisions)
\echo '=== Step 5: Variance Lines (Pending Decisions) ==='
SELECT 
  ccl.id,
  ccl.line_number,
  ci.name as item_name,
  ci.sku,
  ccl.qty_expected,
  ccl.qty_counted,
  ccl.variance,
  ccl.decision_status,
  ccl.decision_reason
FROM inventory.cycle_count_lines ccl
JOIN inventory.catalog_items ci ON ci.id = ccl.catalog_item_id
WHERE ccl.cycle_count_id = 'YOUR_CYCLE_COUNT_ID'::uuid
ORDER BY ccl.line_number;

-- Step 6: Make variance decisions
\echo '=== Step 6: Make Decisions ==='

-- Accept line 1 (negative variance) - usage not recorded
UPDATE inventory.cycle_count_lines
SET 
  decision_status = 'accepted',
  decision_reason = 'usage_not_recorded',
  decision_notes = 'Material used for equipment maintenance',
  decided_at = NOW()
WHERE cycle_count_id = 'YOUR_CYCLE_COUNT_ID'::uuid
  AND line_number = 1;

-- Accept line 2 (positive variance) - receiving error
UPDATE inventory.cycle_count_lines
SET 
  decision_status = 'accepted',
  decision_reason = 'receiving_error',
  decision_notes = 'Receiving qty was underreported',
  decided_at = NOW()
WHERE cycle_count_id = 'YOUR_CYCLE_COUNT_ID'::uuid
  AND line_number = 2;

-- Line 3 has no variance, auto-accepted

\echo '=== Step 7: Verify Decisions Made ==='
SELECT 
  ccl.line_number,
  ci.sku,
  ccl.variance,
  ccl.decision_status,
  ccl.decision_reason
FROM inventory.cycle_count_lines ccl
JOIN inventory.catalog_items ci ON ci.id = ccl.catalog_item_id
WHERE ccl.cycle_count_id = 'YOUR_CYCLE_COUNT_ID'::uuid
ORDER BY ccl.line_number;

-- Step 8: Check stock balances BEFORE approval
\echo '=== Step 8: Stock Balances (BEFORE Approval) ==='
SELECT 
  ci.sku,
  sb.qty_on_hand as current_qty,
  ccl.variance as will_adjust_by,
  sb.qty_on_hand + ccl.variance as expected_after
FROM inventory.cycle_count_lines ccl
JOIN inventory.catalog_items ci ON ci.id = ccl.catalog_item_id
JOIN inventory.stock_balances sb ON sb.catalog_item_id = ci.id 
  AND sb.location_id = ccl.location_id
  AND sb.tenant_id = ccl.tenant_id
WHERE ccl.cycle_count_id = 'YOUR_CYCLE_COUNT_ID'::uuid
  AND ccl.decision_status = 'accepted'
ORDER BY ccl.line_number;

-- Step 9: Simulate approve endpoint
-- (In production, this is done via POST /api/inventory/cycle-counts/[id]/approve)
\echo '=== Step 9: Simulating Approval Process ==='

-- Create stock movements for accepted variances
WITH accepted_lines AS (
  SELECT 
    ccl.id as line_id,
    ccl.tenant_id,
    ccl.catalog_item_id,
    ccl.location_id,
    ccl.variance,
    ccl.decision_reason,
    ccl.decision_notes,
    ccl.qty_expected,
    ccl.qty_counted
  FROM inventory.cycle_count_lines ccl
  WHERE ccl.cycle_count_id = 'YOUR_CYCLE_COUNT_ID'::uuid
    AND ccl.decision_status = 'accepted'
    AND ABS(ccl.variance) > 0.01
)
INSERT INTO inventory.stock_movements (
  tenant_id,
  catalog_item_id,
  from_location_id,
  to_location_id,
  qty,
  movement_type,
  reason_code,
  notes,
  reference_id,
  reference_type,
  moved_at
)
SELECT 
  tenant_id,
  catalog_item_id,
  CASE WHEN variance < 0 THEN location_id ELSE NULL END,
  CASE WHEN variance > 0 THEN location_id ELSE NULL END,
  ABS(variance),
  'adjustment',
  decision_reason,
  decision_notes || ' (Expected: ' || qty_expected || ', Counted: ' || qty_counted || ')',
  line_id,
  'cycle_count_line',
  NOW()
FROM accepted_lines
RETURNING id, catalog_item_id, qty, movement_type, reason_code;

-- Update stock balances
\echo '=== Step 10: Update Stock Balances ==='
WITH accepted_lines AS (
  SELECT 
    ccl.tenant_id,
    ccl.catalog_item_id,
    ccl.location_id,
    ccl.variance
  FROM inventory.cycle_count_lines ccl
  WHERE ccl.cycle_count_id = 'YOUR_CYCLE_COUNT_ID'::uuid
    AND ccl.decision_status = 'accepted'
    AND ABS(ccl.variance) > 0.01
)
UPDATE inventory.stock_balances sb
SET 
  qty_on_hand = sb.qty_on_hand + al.variance,
  updated_at = NOW()
FROM accepted_lines al
WHERE sb.tenant_id = al.tenant_id
  AND sb.catalog_item_id = al.catalog_item_id
  AND sb.location_id = al.location_id
RETURNING sb.catalog_item_id, sb.qty_on_hand;

-- Step 11: Post the cycle count
\echo '=== Step 11: Post Cycle Count ==='
UPDATE inventory.cycle_counts
SET 
  status = 'posted',
  approved_at = NOW(),
  posted_at = NOW()
WHERE id = 'YOUR_CYCLE_COUNT_ID'::uuid
RETURNING id, status, approved_at;

-- Step 12: Verify final results
\echo '=== Step 12: FINAL VERIFICATION ==='

\echo '--- Stock Balances (AFTER Approval) ---'
SELECT 
  ci.sku,
  sb.qty_on_hand as final_qty
FROM inventory.cycle_count_lines ccl
JOIN inventory.catalog_items ci ON ci.id = ccl.catalog_item_id
JOIN inventory.stock_balances sb ON sb.catalog_item_id = ci.id 
  AND sb.location_id = ccl.location_id
  AND sb.tenant_id = ccl.tenant_id
WHERE ccl.cycle_count_id = 'YOUR_CYCLE_COUNT_ID'::uuid
ORDER BY ci.sku;

\echo '--- Stock Movements Created ---'
SELECT 
  sm.id,
  ci.sku,
  sm.qty,
  sm.movement_type,
  sm.reason_code,
  sm.notes,
  sm.moved_at
FROM inventory.stock_movements sm
JOIN inventory.catalog_items ci ON ci.id = sm.catalog_item_id
WHERE sm.reference_id IN (
  SELECT id FROM inventory.cycle_count_lines 
  WHERE cycle_count_id = 'YOUR_CYCLE_COUNT_ID'::uuid
)
ORDER BY sm.moved_at;

\echo '--- Cycle Count Summary ---'
SELECT 
  cc.count_number,
  cc.status,
  COUNT(ccl.id) as total_lines,
  COUNT(CASE WHEN ABS(ccl.variance) > 0.01 THEN 1 END) as variance_lines,
  COUNT(CASE WHEN ccl.decision_status = 'accepted' THEN 1 END) as accepted,
  COUNT(CASE WHEN ccl.decision_status = 'investigating' THEN 1 END) as investigating,
  COUNT(CASE WHEN ccl.decision_status = 'rejected' THEN 1 END) as rejected
FROM inventory.cycle_counts cc
LEFT JOIN inventory.cycle_count_lines ccl ON ccl.cycle_count_id = cc.id
WHERE cc.id = 'YOUR_CYCLE_COUNT_ID'::uuid
GROUP BY cc.id, cc.count_number, cc.status;

\echo '=== TEST COMPLETE ==='
\echo 'Expected Results:'
\echo '1. Stock movements created for 2 accepted variances'
\echo '2. Stock balances updated by variance delta'
\echo '3. Cycle count status = posted'
\echo '4. No variances with pending status'
