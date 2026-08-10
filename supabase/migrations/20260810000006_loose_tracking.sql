-- 08 — Loosely-tracked items: honest "~about this many" inventory.
--
-- Some items can't be counted precisely (consumables, bulk stock, stuff that
-- walks). Flagging an item "loosely tracked" makes its quantities read as
-- estimates (~N), stops cycle counts from screaming about variances on it
-- (counts still run — that's how the estimate gets re-trued — but their
-- variances auto-accept instead of blocking the post), and lets anyone push a
-- quick "eyeball update" so the number stays roughly right.
--
-- WHERE THE COLUMNS LIVE — decision:
--   loose_tracking is a property of the ITEM ("is this thing countable?"), so it
--   lives on inventory.catalog_items alongside the existing tracking_mode. It is
--   NOT per-location: an item is either the loose kind or it isn't, everywhere.
--   last_verified_at/by (when the estimate was last eyeballed or counted) also
--   live on catalog_items — estimate freshness is an item-level fact, and the
--   per-location ledger (stock_movements) already records the granular history.
--   A separate qty_confidence column was considered and skipped: loose_tracking
--   already fully determines the 'estimate' display state, so a second column
--   would only be a denormalized duplicate to keep in sync.
--
-- Posture: extend. Tracked/serialized items behave exactly as today; loose
-- tracking is opt-in per item and defaults off. Reservations, min-levels,
-- PO/receiving math are untouched — loose items keep a real qty_on_hand, it's
-- just presented (and re-trued) as an estimate.

ALTER TABLE inventory.catalog_items
  ADD COLUMN IF NOT EXISTS loose_tracking boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS last_verified_by uuid NULL;

COMMENT ON COLUMN inventory.catalog_items.loose_tracking IS
  'When true, this item''s quantities are treated as estimates: displayed as ~N, cycle-count variances auto-accept as "re-trued" instead of flagging for review, and anyone can push an eyeball update. Opt-in per item; default false = precise tracking as before.';
COMMENT ON COLUMN inventory.catalog_items.last_verified_at IS
  'For loose_tracking items: when the estimate was last re-trued (via an eyeball update or a cycle count). Drives the staleness warning on the display (~N shown as old when >30 days).';
COMMENT ON COLUMN inventory.catalog_items.last_verified_by IS
  'User who last re-trued the estimate (eyeball update or count).';

-- === Cycle counts respect the loose flag ==================================
-- rpc_inv_cycle_count_record already computes variance and calls
-- check_variance_approval to decide requires_approval. For a loose item we
-- short-circuit that: the count IS the re-truing, so its variance never needs a
-- human decision. We force auto_approved and pre-stamp decision_status =
-- 'accepted' with a distinct reason ('estimate_retrued') so the existing
-- variance-review gate (which blocks posting on undecided variance lines) sails
-- through and the review UI can separate these from real discrepancies. We also
-- stamp the item's last_verified_at/by so its estimate reads fresh again.
CREATE OR REPLACE FUNCTION inventory.rpc_inv_cycle_count_record(
    p_tenant_id uuid,
    p_cycle_count_id uuid,
    p_catalog_item_id uuid,
    p_counted_qty numeric,
    p_last_event_id text DEFAULT NULL::text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'inventory', 'supply_chain', 'public', 'extensions'
AS $function$
DECLARE
    v_count RECORD;
    v_line RECORD;
    v_item RECORD;
    v_requires_approval BOOLEAN;
    v_variance_qty NUMERIC;
    v_variance_pct NUMERIC;
    v_expected NUMERIC;
    v_actor uuid;
BEGIN
    SELECT * INTO v_count
    FROM inventory.cycle_counts
    WHERE id = p_cycle_count_id AND tenant_id = p_tenant_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cycle count not found';
    END IF;

    IF v_count.status != 'in_progress' THEN
        RAISE EXCEPTION 'Count is not in progress';
    END IF;

    SELECT * INTO v_line
    FROM inventory.cycle_count_lines
    WHERE cycle_count_id = p_cycle_count_id
      AND catalog_item_id = p_catalog_item_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Item not in this count';
    END IF;

    SELECT * INTO v_item
    FROM inventory.catalog_items
    WHERE id = p_catalog_item_id;

    v_expected := COALESCE(v_line.qty_expected, 0);
    v_variance_qty := p_counted_qty - v_expected;
    IF v_expected = 0 THEN
        v_variance_pct := NULL;
    ELSE
        v_variance_pct := (v_variance_qty / v_expected) * 100;
    END IF;

    IF COALESCE(v_item.loose_tracking, false) THEN
        -- Loose item: the count is the re-truing. Never require a human
        -- decision; pre-accept so the post gate passes and stock still updates.
        v_actor := COALESCE(
            NULLIF(auth.jwt() ->> 'user_id', '')::uuid,
            auth.uid()
        );

        UPDATE inventory.cycle_count_lines
        SET
            qty_counted = p_counted_qty,
            variance_qty = v_variance_qty,
            variance_pct = v_variance_pct,
            requires_approval = FALSE,
            auto_approved = TRUE,
            decision_status = 'accepted',
            decision_reason = 'estimate_retrued',
            decided_at = NOW(),
            counted_at = NOW(),
            updated_at = NOW()
        WHERE id = v_line.id;

        UPDATE inventory.catalog_items
        SET last_verified_at = NOW(),
            last_verified_by = v_actor
        WHERE id = p_catalog_item_id AND tenant_id = p_tenant_id;

        RETURN TRUE;
    END IF;

    -- Precise item: unchanged behavior.
    v_requires_approval := inventory.check_variance_approval(
        p_tenant_id => p_tenant_id,
        p_catalog_item_id => p_catalog_item_id,
        p_location_id => v_count.location_id,
        p_item_category_id => v_item.category_id,
        p_variance_qty => v_variance_qty,
        p_expected_qty => v_expected
    );

    UPDATE inventory.cycle_count_lines
    SET
        qty_counted = p_counted_qty,
        variance_qty = v_variance_qty,
        variance_pct = v_variance_pct,
        requires_approval = v_requires_approval,
        auto_approved = NOT v_requires_approval,
        counted_at = NOW(),
        updated_at = NOW()
    WHERE id = v_line.id;

    RETURN TRUE;
END;
$function$;

-- === Item stock snapshot returns the loose flag + freshness ===============
-- Decorate the existing snapshot payload with loose_tracking, last_verified_at,
-- and last_verified_by so the item detail page can render ~N + an estimate chip
-- + staleness. Everything else about the RPC is unchanged.
CREATE OR REPLACE FUNCTION inventory.rpc_item_stock_snapshot(p_catalog_item_id uuid, p_tenant_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'inventory', 'public'
AS $function$
DECLARE
  v_tenant_id       uuid;
  v_item            record;
  v_totals          record;
  v_inbound         numeric(18,4);
  v_locations       jsonb;
  v_last_movement   timestamptz;
  v_last_count      timestamptz;
  v_variants        jsonb := NULL;
BEGIN
  v_tenant_id := COALESCE(p_tenant_id, public.current_tenant_id());
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT ci.id, ci.name, ci.sku, ci.barcode,
         ci.uom_term_id, ci.tracking_mode,
         ci.reorder_point, ci.active, ci.last_event_id,
         ci.is_parent, ci.parent_item_id, ci.variant_attributes,
         ci.variant_dimensions, ci.variant_options,
         ci.loose_tracking, ci.last_verified_at, ci.last_verified_by,
         ic.name AS category_name
  INTO v_item
  FROM inventory.catalog_items ci
  LEFT JOIN inventory.item_categories ic ON ic.id = ci.category_id AND ic.tenant_id = v_tenant_id
  WHERE ci.id = p_catalog_item_id
    AND ci.tenant_id = v_tenant_id
    AND ci.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item not found';
  END IF;

  IF v_item.is_parent THEN
    SELECT
      COALESCE(SUM(sb.qty_on_hand), 0)   AS on_hand,
      COALESCE(SUM(sb.qty_reserved), 0)  AS reserved,
      COALESCE(SUM(sb.qty_available), 0) AS available
    INTO v_totals
    FROM inventory.stock_balances sb
    WHERE sb.tenant_id = v_tenant_id
      AND sb.catalog_item_id IN (
        SELECT ci2.id FROM inventory.catalog_items ci2
        WHERE ci2.tenant_id = v_tenant_id
          AND ci2.parent_item_id = p_catalog_item_id
          AND ci2.deleted_at IS NULL
      );

    SELECT COALESCE(SUM(pol.qty_ordered - pol.qty_received), 0)
    INTO v_inbound
    FROM supply_chain.purchase_order_lines pol
    JOIN supply_chain.purchase_orders po ON po.id = pol.po_id AND po.tenant_id = v_tenant_id
    WHERE pol.tenant_id = v_tenant_id
      AND pol.catalog_item_id IN (
        SELECT ci2.id FROM inventory.catalog_items ci2
        WHERE ci2.tenant_id = v_tenant_id
          AND ci2.parent_item_id = p_catalog_item_id
          AND ci2.deleted_at IS NULL
      )
      AND pol.status IN ('open', 'partially_received', 'pending')
      AND po.status NOT IN ('cancelled', 'closed', 'fully_received', 'draft');

    SELECT COALESCE(jsonb_agg(row_to_json(r)::jsonb ORDER BY r.location_name), '[]'::jsonb)
    INTO v_locations
    FROM (
      SELECT
        sb.location_id,
        l.name AS location_name,
        SUM(sb.qty_on_hand)   AS on_hand,
        SUM(sb.qty_reserved)  AS reserved,
        SUM(sb.qty_available) AS available
      FROM inventory.stock_balances sb
      JOIN inventory.locations l ON l.id = sb.location_id AND l.tenant_id = v_tenant_id
      WHERE sb.tenant_id = v_tenant_id
        AND sb.catalog_item_id IN (
          SELECT ci2.id FROM inventory.catalog_items ci2
          WHERE ci2.tenant_id = v_tenant_id
            AND ci2.parent_item_id = p_catalog_item_id
            AND ci2.deleted_at IS NULL
        )
      GROUP BY sb.location_id, l.name
      HAVING SUM(sb.qty_on_hand) != 0 OR SUM(sb.qty_reserved) != 0
    ) r;

    SELECT MAX(sm.occurred_at)
    INTO v_last_movement
    FROM inventory.stock_movements sm
    WHERE sm.tenant_id = v_tenant_id
      AND sm.catalog_item_id IN (
        SELECT ci2.id FROM inventory.catalog_items ci2
        WHERE ci2.tenant_id = v_tenant_id
          AND ci2.parent_item_id = p_catalog_item_id
          AND ci2.deleted_at IS NULL
      )
      AND sm.posting_status = 'posted';

    SELECT MAX(sm.occurred_at)
    INTO v_last_count
    FROM inventory.stock_movements sm
    WHERE sm.tenant_id = v_tenant_id
      AND sm.catalog_item_id IN (
        SELECT ci2.id FROM inventory.catalog_items ci2
        WHERE ci2.tenant_id = v_tenant_id
          AND ci2.parent_item_id = p_catalog_item_id
          AND ci2.deleted_at IS NULL
      )
      AND sm.movement_type = 'counted'
      AND sm.posting_status = 'posted';

    SELECT COALESCE(jsonb_agg(row_to_json(vr)::jsonb ORDER BY vr.variant_name), '[]'::jsonb)
    INTO v_variants
    FROM (
      SELECT
        ci2.id AS variant_id,
        ci2.name AS variant_name,
        ci2.sku AS variant_sku,
        ci2.barcode AS variant_barcode,
        ci2.variant_attributes,
        COALESCE(SUM(sb.qty_on_hand), 0) AS on_hand,
        COALESCE(SUM(sb.qty_reserved), 0) AS reserved,
        COALESCE(SUM(sb.qty_available), 0) AS available
      FROM inventory.catalog_items ci2
      LEFT JOIN inventory.stock_balances sb
        ON sb.catalog_item_id = ci2.id AND sb.tenant_id = v_tenant_id
      WHERE ci2.tenant_id = v_tenant_id
        AND ci2.parent_item_id = p_catalog_item_id
        AND ci2.deleted_at IS NULL
      GROUP BY ci2.id, ci2.name, ci2.sku, ci2.barcode, ci2.variant_attributes
    ) vr;

  ELSE
    SELECT
      COALESCE(SUM(sb.qty_on_hand), 0)   AS on_hand,
      COALESCE(SUM(sb.qty_reserved), 0)  AS reserved,
      COALESCE(SUM(sb.qty_available), 0) AS available
    INTO v_totals
    FROM inventory.stock_balances sb
    WHERE sb.tenant_id = v_tenant_id
      AND sb.catalog_item_id = p_catalog_item_id;

    SELECT COALESCE(SUM(pol.qty_ordered - pol.qty_received), 0)
    INTO v_inbound
    FROM supply_chain.purchase_order_lines pol
    JOIN supply_chain.purchase_orders po ON po.id = pol.po_id AND po.tenant_id = v_tenant_id
    WHERE pol.tenant_id = v_tenant_id
      AND pol.catalog_item_id = p_catalog_item_id
      AND pol.status IN ('open', 'partially_received', 'pending')
      AND po.status NOT IN ('cancelled', 'closed', 'fully_received', 'draft');

    SELECT COALESCE(jsonb_agg(row_to_json(r)::jsonb ORDER BY r.location_name), '[]'::jsonb)
    INTO v_locations
    FROM (
      SELECT
        sb.location_id,
        l.name AS location_name,
        sb.qty_on_hand  AS on_hand,
        sb.qty_reserved AS reserved,
        sb.qty_available AS available
      FROM inventory.stock_balances sb
      JOIN inventory.locations l ON l.id = sb.location_id AND l.tenant_id = v_tenant_id
      WHERE sb.tenant_id = v_tenant_id
        AND sb.catalog_item_id = p_catalog_item_id
        AND (sb.qty_on_hand != 0 OR sb.qty_reserved != 0)
    ) r;

    SELECT MAX(sm.occurred_at)
    INTO v_last_movement
    FROM inventory.stock_movements sm
    WHERE sm.tenant_id = v_tenant_id
      AND sm.catalog_item_id = p_catalog_item_id
      AND sm.posting_status = 'posted';

    SELECT MAX(sm.occurred_at)
    INTO v_last_count
    FROM inventory.stock_movements sm
    WHERE sm.tenant_id = v_tenant_id
      AND sm.catalog_item_id = p_catalog_item_id
      AND sm.movement_type = 'counted'
      AND sm.posting_status = 'posted';
  END IF;

  RETURN jsonb_build_object(
    'item', jsonb_build_object(
      'id', v_item.id,
      'name', v_item.name,
      'sku', v_item.sku,
      'barcode', v_item.barcode,
      'uom_term_id', v_item.uom_term_id,
      'tracking_mode', v_item.tracking_mode,
      'reorder_point', v_item.reorder_point,
      'category_name', v_item.category_name,
      'active', v_item.active,
      'last_event_id', v_item.last_event_id,
      'is_parent', v_item.is_parent,
      'parent_item_id', v_item.parent_item_id,
      'variant_attributes', v_item.variant_attributes,
      'variant_dimensions', v_item.variant_dimensions,
      'variant_options', v_item.variant_options,
      'loose_tracking', v_item.loose_tracking,
      'last_verified_at', v_item.last_verified_at,
      'last_verified_by', v_item.last_verified_by
    ),
    'on_hand', v_totals.on_hand,
    'reserved', v_totals.reserved,
    'available', v_totals.available,
    'inbound', v_inbound,
    'locations', v_locations,
    'last_movement_at', v_last_movement,
    'last_count_at', v_last_count,
    'variants', v_variants
  );
END;
$function$;
