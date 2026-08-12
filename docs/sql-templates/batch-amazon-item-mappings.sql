-- =============================================================================
-- Batch-create catalog items + Amazon Business mappings (STAGE ONLY)
-- =============================================================================
-- Creates inventory.catalog_items rows and their supply_chain.vendor_items
-- (Amazon) mappings in ONE transaction. New catalog_items.id flows straight
-- into the vendor_items insert via CTE — no UUID copy-pasting.
--
-- Mirrors what POST /api/settings/integrations/amazon-business/item-mappings
-- writes (ASIN -> vendor_items.vendor_sku, onConflict tenant+vendor+item).
--
-- BEFORE RUNNING — resolve these IDs for the target tenant (values below are
-- the STAGE demo tenant as of 2026-06):
--   tenant_id : 052abee2-ffdc-470e-975a-b917dde72b8e
--   Amazon vendor_id (code = 'AMAZON-BIZ'):
--     SELECT id FROM supply_chain.vendors
--      WHERE tenant_id = :tenant AND code = 'AMAZON-BIZ' AND active = true;
--   default "each" UOM term used by every existing item:
--     e4624aa5-8637-4967-b48d-3b11e085d0cf
--   category_id options:
--     SELECT id, name FROM inventory.item_categories WHERE tenant_id = :tenant;
--       Containers      80f40c9a-8df9-436a-9ee7-3d0186e7b41c
--       Electronics     7921df42-4d23-42a6-bfed-6fdb93569876
--       Office Supplies e4279c40-20c2-42ab-8826-fa844155dedc
--       PPE             4163f38b-39e8-4bbf-b4e3-8280a68996a4
--       Safety          e1d23757-c131-4c52-a38c-b0658bcdb2bf
--       Tools           3473b2a3-e458-4c51-87f6-43b3486ea29c
--
-- NOTES / GOTCHAS:
--   * ASIN must be exactly 10 alphanumerics ([A-Z0-9]{10}); extract from a URL
--     via the /dp/<ASIN> or /gp/product/<ASIN> segment.
--   * tracking_mode in ('stock','serialized','both'); 'stock' for consumables.
--   * last_event_id is NOT NULL on BOTH tables — gen_random_uuid()::text per row.
--   * catalog_items NOT NULL cols: tenant_id, sku, name, tracking_mode,
--     uom_term_id, last_event_id (rest default).
--   * vendor_items NOT NULL cols: tenant_id, vendor_id, catalog_item_id,
--     last_event_id (rest default).
--   * Unique key on vendor_items: (tenant_id, vendor_id, catalog_item_id) — one
--     Amazon mapping per item. catalog_items.sku is unique per tenant.
--   * Amazon prices load via JS, so server-side fetch usually yields NULL price.
--     Leave last_known_price NULL and fill later, or set it if you have it.
--   * pack_size = how many catalog units come in ONE Amazon purchase unit
--     (e.g. a "6 rolls" listing where your unit is a single roll => 6).
--   * Run on STAGE only (project ref qnbrrutjbyrjmwohcbcv). Never dev/prod/GV.
-- =============================================================================

WITH data(sku, name, asin, category_id, pack_size, price, is_preferred) AS (
  VALUES
    -- sku,        name,                                  asin,         category_id (uuid),                              pack, price (numeric|NULL), preferred
    ('EXAMPLE-001', 'Example Product Name',               'B00000000X', '3473b2a3-e458-4c51-87f6-43b3486ea29c'::uuid,    1,    NULL::numeric,        false)
    -- ,('EXAMPLE-002', 'Another Product',                 'B00000000Y', '7921df42-4d23-42a6-bfed-6fdb93569876'::uuid,    1,    49.99,                true)
),
ins_items AS (
  INSERT INTO inventory.catalog_items
    (tenant_id, sku, name, tracking_mode, uom_term_id, category_id, pack_size, active, last_event_id)
  SELECT '052abee2-ffdc-470e-975a-b917dde72b8e'::uuid,   -- :tenant
         d.sku, d.name, 'stock',
         'e4624aa5-8637-4967-b48d-3b11e085d0cf'::uuid,    -- :uom (each)
         d.category_id, d.pack_size, true,
         gen_random_uuid()::text
  FROM data d
  RETURNING id, sku
),
ins_map AS (
  INSERT INTO supply_chain.vendor_items
    (tenant_id, vendor_id, catalog_item_id, vendor_sku, pack_size,
     last_known_price, price_checked_at, is_preferred, active, auto_order_enabled, last_event_id)
  SELECT '052abee2-ffdc-470e-975a-b917dde72b8e'::uuid,   -- :tenant
         '68adeba2-d126-43b9-886a-838c3e218b35'::uuid,   -- :amazon_vendor_id
         i.id, d.asin, d.pack_size,
         d.price,
         CASE WHEN d.price IS NOT NULL THEN now() ELSE NULL END,
         d.is_preferred, true, false,
         gen_random_uuid()::text
  FROM ins_items i JOIN data d ON d.sku = i.sku
  RETURNING catalog_item_id, vendor_sku
)
SELECT i.sku, i.id AS catalog_item_id, m.vendor_sku AS asin
FROM ins_items i JOIN ins_map m ON m.catalog_item_id = i.id
ORDER BY i.sku;

-- -----------------------------------------------------------------------------
-- Variant: items ALREADY exist, only add/refresh the Amazon mapping.
-- Upsert mirrors the API route's onConflict behavior.
-- -----------------------------------------------------------------------------
-- WITH data(catalog_item_id, asin, pack_size, price, is_preferred) AS (
--   VALUES
--     ('<catalog_item_uuid>'::uuid, 'B00000000X', 1, NULL::numeric, false)
-- )
-- INSERT INTO supply_chain.vendor_items
--   (tenant_id, vendor_id, catalog_item_id, vendor_sku, pack_size,
--    last_known_price, price_checked_at, is_preferred, active, auto_order_enabled, last_event_id)
-- SELECT '052abee2-ffdc-470e-975a-b917dde72b8e'::uuid,
--        '68adeba2-d126-43b9-886a-838c3e218b35'::uuid,
--        d.catalog_item_id, d.asin, d.pack_size,
--        d.price, CASE WHEN d.price IS NOT NULL THEN now() ELSE NULL END,
--        d.is_preferred, true, false, gen_random_uuid()::text
-- FROM data d
-- ON CONFLICT (tenant_id, vendor_id, catalog_item_id) DO UPDATE
--   SET vendor_sku = EXCLUDED.vendor_sku,
--       pack_size = EXCLUDED.pack_size,
--       last_known_price = EXCLUDED.last_known_price,
--       price_checked_at = EXCLUDED.price_checked_at,
--       is_preferred = EXCLUDED.is_preferred,
--       active = true,
--       updated_at = now();

-- -----------------------------------------------------------------------------
-- Variant: backfill prices later (once you have them).
-- -----------------------------------------------------------------------------
-- UPDATE supply_chain.vendor_items vi
-- SET last_known_price = p.price, price_checked_at = now(), updated_at = now()
-- FROM (VALUES
--   ('B00125TIS2', 22.49::numeric),
--   ('B0002YWNLS', 14.95)
-- ) AS p(asin, price)
-- WHERE vi.vendor_sku = p.asin
--   AND vi.tenant_id = '052abee2-ffdc-470e-975a-b917dde72b8e'
--   AND vi.vendor_id = '68adeba2-d126-43b9-886a-838c3e218b35';
