-- 20260812000006_job_shortage_to_po.sql
-- V1-C: Shortage → draft PO — close the sold-job supply loop (sprint 2026-08-12 #23).
--
-- When jobs reserve more material than the yard can cover, nothing turned that
-- gap into a buy. This adds the read side of the bridge:
--
-- 1. inventory.v_job_material_shortage — per (tenant, item, location) that has
--    at least one ACTIVE FUNGIBLE JOB reservation, the honest unmet demand.
--
--    Math note (deviates from the spike's literal formula on purpose): since
--    20260812000003 (V1-A) the reservations→stock_balances trigger keeps
--    qty_reserved = Σ active fungible holds, and qty_available is GENERATED as
--    qty_on_hand - qty_reserved (it goes NEGATIVE when over-reserved — that is
--    the truthful shortage signal). The spike wrote
--        shortfall = demand - (qty_available + qty_on_order)
--    but qty_available ALREADY nets out that same demand, so the literal form
--    would double-count. The equivalent honest form used here:
--        demand_total = qty_reserved            (all active fungible holds)
--        shortfall    = GREATEST(demand_total - (qty_on_hand + qty_on_order), 0)
--                     = GREATEST(-(qty_available + qty_on_order), 0)
--                     = the negative part of inventory_position.
--    demand_total (not just job demand) is the right buy number: manual
--    warehouse holds are real claims on the same stock.
--
--    On-order comes from v_on_order_by_item_location, which counts every PO
--    that isn't cancelled/closed — INCLUDING fresh drafts. So the moment the
--    one-tap shortfall PO is drafted, the row clears from this view: natural
--    data-level idempotence on top of the route's Idempotency-Key guard.
--
--    suggested_order_qty: at least the shortfall, topped up to reorder_qty if
--    that's bigger, but capped at shortfall + target_level where a target is
--    set (never refill past target, never suggest less than the shortfall).
--
--    Per-job variant = filter `jobs @> '[{"job_id": "..."}]'` (each jobs
--    element carries job_id/job_name/qty/needed_by, so containment on job_id
--    alone matches). The ops readiness card reads it that way.
--
-- 2. purchase_orders.origin gains 'shortfall' so the inbox can badge these
--    drafts (same pattern as 'auto_reorder' / 'guided_purchase').

-- ── 1. Shortage view ─────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW inventory.v_job_material_shortage AS
WITH job_demand AS (
    SELECT r.tenant_id,
           r.catalog_item_id,
           r.location_id,
           SUM(r.qty) AS job_demand,
           MIN(r.needed_by) AS earliest_needed_by,
           jsonb_agg(
             jsonb_build_object(
               'job_id',    r.job_ref->>'job_id',
               'job_name',  r.job_ref->>'job_name',
               'qty',       r.qty,
               'needed_by', r.needed_by
             ) ORDER BY r.created_at
           ) AS jobs
    FROM inventory.reservations r
    WHERE r.status = 'active'
      AND r.reservation_type = 'fungible'
      AND r.allocation_type = 'job'
      AND (r.job_ref ? 'job_id')
    GROUP BY r.tenant_id, r.catalog_item_id, r.location_id
), base AS (
    SELECT d.tenant_id,
           d.catalog_item_id,
           d.location_id,
           d.job_demand,
           d.earliest_needed_by,
           d.jobs,
           COALESCE(sb.qty_on_hand, 0)   AS qty_on_hand,
           COALESCE(sb.qty_reserved, 0)  AS demand_total,
           COALESCE(sb.qty_available, 0) AS qty_available,
           COALESCE(oo.qty_on_order, 0)  AS qty_on_order,
           GREATEST(
             COALESCE(sb.qty_reserved, 0)
               - (COALESCE(sb.qty_on_hand, 0) + COALESCE(oo.qty_on_order, 0)),
             0
           ) AS shortfall
    FROM job_demand d
    LEFT JOIN inventory.stock_balances sb
      ON sb.tenant_id = d.tenant_id
     AND sb.catalog_item_id = d.catalog_item_id
     AND sb.location_id = d.location_id
    LEFT JOIN inventory.v_on_order_by_item_location oo
      ON oo.tenant_id = d.tenant_id
     AND oo.catalog_item_id = d.catalog_item_id
     AND oo.location_id = d.location_id
)
SELECT b.tenant_id,
       b.catalog_item_id,
       ci.sku,
       ci.name AS item_name,
       ci.uom_term_id,
       b.location_id,
       l.name AS location_name,
       b.job_demand,
       b.demand_total,
       b.qty_on_hand,
       b.qty_available,
       b.qty_on_order,
       b.qty_available + b.qty_on_order AS inventory_position,
       b.shortfall,
       b.earliest_needed_by,
       b.jobs,
       COALESCE(ci.preferred_vendor_id, l.preferred_vendor_id) AS preferred_vendor_id,
       v.name AS preferred_vendor_name,
       COALESCE(ci.reorder_qty, 0) AS reorder_qty,
       ci.target_level,
       CASE
         WHEN COALESCE(ci.target_level, 0) > 0 THEN
           LEAST(
             GREATEST(b.shortfall, COALESCE(ci.reorder_qty, 0)),
             b.shortfall + ci.target_level
           )
         ELSE GREATEST(b.shortfall, COALESCE(ci.reorder_qty, 0))
       END AS suggested_order_qty,
       vi.unit_cost AS estimated_unit_cost
FROM base b
JOIN inventory.catalog_items ci ON ci.id = b.catalog_item_id
JOIN inventory.locations l ON l.id = b.location_id
LEFT JOIN supply_chain.vendors v
  ON v.id = COALESCE(ci.preferred_vendor_id, l.preferred_vendor_id)
LEFT JOIN supply_chain.vendor_items vi
  ON vi.catalog_item_id = b.catalog_item_id
 AND vi.vendor_id = COALESCE(ci.preferred_vendor_id, l.preferred_vendor_id)
 AND vi.active IS NOT FALSE
WHERE b.shortfall > 0
  AND ci.active = true;

GRANT SELECT ON inventory.v_job_material_shortage TO authenticated, service_role;

-- ── 2. Allow origin = 'shortfall' ────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'supply_chain.purchase_orders'::regclass
      AND conname = 'purchase_orders_origin_check'
  ) THEN
    ALTER TABLE supply_chain.purchase_orders DROP CONSTRAINT purchase_orders_origin_check;
  END IF;

  ALTER TABLE supply_chain.purchase_orders
    ADD CONSTRAINT purchase_orders_origin_check
    CHECK (origin IN ('user', 'agent', 'auto_reorder', 'guided_purchase', 'shortfall'));
END $$;
