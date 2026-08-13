-- 20260812000004_reservation_integrity_fungible_only.sql
-- Companion to 20260812000003_reserved_availability_sync: align the
-- v_reservation_integrity drift detector with the documented model.
--
-- stock_balances.qty_reserved counts ACTIVE FUNGIBLE reservations only —
-- serialized holds reserve a specific asset_id (carried by assets.status),
-- not fungible quantity. The view previously summed ALL active reservations,
-- so every serialized equipment-mirror hold (FLEET-EQUIPMENT-MIRROR) reported
-- a permanent false MISMATCH against the (correctly serialized-free) balance.
-- Restrict the reservation side of the comparison to fungible rows.

CREATE OR REPLACE VIEW inventory.v_reservation_integrity AS
WITH reservation_totals AS (
    SELECT r.tenant_id,
           r.catalog_item_id,
           r.location_id,
           sum(r.qty) AS total_reserved
    FROM inventory.reservations r
    WHERE r.status = 'active'
      AND r.reservation_type = 'fungible'
    GROUP BY r.tenant_id, r.catalog_item_id, r.location_id
)
SELECT rt.tenant_id,
       rt.catalog_item_id,
       ci.sku,
       ci.name AS item_name,
       rt.location_id,
       l.name AS location_name,
       rt.total_reserved AS calculated_reserved,
       sb.qty_reserved AS balance_reserved,
       sb.qty_on_hand,
       rt.total_reserved - COALESCE(sb.qty_reserved, 0::numeric) AS variance,
       CASE
           WHEN rt.total_reserved > sb.qty_on_hand THEN 'OVER_RESERVED'::text
           WHEN rt.total_reserved <> COALESCE(sb.qty_reserved, 0::numeric) THEN 'MISMATCH'::text
           ELSE 'OK'::text
       END AS status
FROM reservation_totals rt
LEFT JOIN inventory.stock_balances sb
       ON sb.tenant_id = rt.tenant_id
      AND sb.catalog_item_id = rt.catalog_item_id
      AND sb.location_id = rt.location_id
LEFT JOIN inventory.catalog_items ci ON ci.id = rt.catalog_item_id
LEFT JOIN inventory.locations l ON l.id = rt.location_id
WHERE rt.total_reserved > COALESCE(sb.qty_on_hand, 0::numeric)
   OR rt.total_reserved <> COALESCE(sb.qty_reserved, 0::numeric);

COMMENT ON VIEW inventory.v_reservation_integrity IS
  'Drift detector: active FUNGIBLE reservation totals vs '
  'stock_balances.qty_reserved per (tenant, item, location). Serialized '
  'holds are excluded — they reserve a specific asset, not fungible qty '
  '(20260812000004).';
