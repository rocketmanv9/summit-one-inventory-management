-- Origin badge + inbox routing for the nightly auto-reorder pass (automagic 03).
--
-- Two gaps closed:
--   1. Generated POs carried no machine-readable origin — the inbox couldn't
--      tell an AI-drafted restock from a person's PO. Add purchase_orders.origin
--      ('user' | 'agent' | 'auto_reorder'), default 'user', and backfill the
--      rows the generator already made (identified by their auto-reorder event id).
--   2. rpc_generate_reorder_pos_v2 left its POs as 'draft', which never appear in
--      the awaiting_approval inbox — a human had to go find them. Now the
--      generator stamps origin='auto_reorder' AND routes each created PO into the
--      approval inbox as 'awaiting_approval' with a resolved approver, so the
--      human's whole job is approve-or-tweak. Nothing is sent to a vendor here;
--      approval is still a separate, human step.
--
-- The inventory.purchase_orders view is recreated to expose origin so the list
-- surface (and the create-review page) can badge it.

-- ── 1. origin column ─────────────────────────────────────────────────────────
ALTER TABLE supply_chain.purchase_orders
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'user';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'supply_chain.purchase_orders'::regclass
      AND conname = 'purchase_orders_origin_check'
  ) THEN
    ALTER TABLE supply_chain.purchase_orders
      ADD CONSTRAINT purchase_orders_origin_check
      CHECK (origin IN ('user', 'agent', 'auto_reorder'));
  END IF;
END $$;

-- Backfill: POs the generator already created carry an 'auto-reorder-…' event id.
UPDATE supply_chain.purchase_orders
SET origin = 'auto_reorder'
WHERE origin = 'user'
  AND last_event_id LIKE 'auto-reorder-%';

-- ── 2. Expose origin on the read view ────────────────────────────────────────
CREATE OR REPLACE VIEW inventory.purchase_orders AS
  SELECT id,
    tenant_id,
    po_number,
    vendor_location_id,
    status,
    order_date,
    expected_delivery_date,
    delivery_location_id,
    notes,
    created_by_user_id,
    approved_by_user_id,
    approved_at,
    created_at,
    updated_at,
    updated_by,
    last_event_id,
    vendor_id,
    vendor_name_snapshot,
    vendor_code_snapshot,
    origin,
    approval_reason,
    approver_user_id
  FROM supply_chain.purchase_orders;

-- ── 3. Generator: stamp origin + route drafts into the approval inbox ─────────
-- Same grouping/skip/idempotency semantics as 20260611100002. Changes:
--   * INSERT sets origin = 'auto_reorder'.
--   * After a PO's lines are built, it is transitioned draft → awaiting_approval
--     with approval_reason 'AI restock draft — nightly reorder (run …)' and an
--     approver resolved from the fallback author + delivery location. If no
--     approver resolves, approver_user_id stays NULL ("any admin can approve").
--   * Nothing here sends to a vendor. Approval remains a distinct human action.
CREATE OR REPLACE FUNCTION supply_chain.rpc_generate_reorder_pos_v2(
  p_tenant_id UUID,
  p_run_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'supply_chain', 'inventory', 'public'
AS $$
DECLARE
  v_run TEXT := COALESCE(p_run_id, to_char(now(), 'YYYYMMDD'));
  v_group RECORD;
  v_sugg RECORD;
  v_po_id UUID;
  v_po_number TEXT;
  v_line_number INT;
  v_po_total NUMERIC;
  v_fallback_user UUID;
  v_approver UUID;
  v_created JSONB := '[]'::jsonb;
  v_skipped INT := 0;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'p_tenant_id is required';
  END IF;

  -- Machine-created rows still need an author; reuse the most recent PO creator.
  SELECT po.created_by_user_id INTO v_fallback_user
  FROM supply_chain.purchase_orders po
  WHERE po.tenant_id = p_tenant_id AND po.created_by_user_id IS NOT NULL
  ORDER BY po.created_at DESC
  LIMIT 1;

  FOR v_group IN
    SELECT rs.preferred_vendor_id AS vendor_id, rs.location_id
    FROM inventory.v_reorder_suggestions rs
    WHERE rs.tenant_id = p_tenant_id
      AND rs.preferred_vendor_id IS NOT NULL
      AND rs.suggested_order_qty > 0
      -- skip items already inbound on an open PO
      AND NOT EXISTS (
        SELECT 1
        FROM supply_chain.purchase_order_lines pol
        JOIN supply_chain.purchase_orders po ON po.id = pol.po_id
        WHERE po.tenant_id = p_tenant_id
          AND pol.catalog_item_id = rs.catalog_item_id
          AND po.status NOT IN ('cancelled', 'voided', 'closed', 'fully_received')
      )
    GROUP BY rs.preferred_vendor_id, rs.location_id
  LOOP
    v_po_number := supply_chain.generate_po_number(p_tenant_id);

    INSERT INTO supply_chain.purchase_orders (
      tenant_id, po_number, vendor_id, status, origin,
      delivery_method, delivery_location_id, cost_context,
      order_date, needed_by_date, notes,
      created_by_user_id, vendor_name_snapshot, vendor_code_snapshot,
      last_event_id
    )
    SELECT
      p_tenant_id, v_po_number, v_group.vendor_id, 'draft', 'auto_reorder',
      'ship', v_group.location_id, 'overhead',
      CURRENT_DATE, CURRENT_DATE + 7,
      'Auto-generated by nightly reorder (run ' || v_run || ')',
      v_fallback_user, v.name, v.code,
      'auto-reorder-' || v_run || '-' || v_group.vendor_id || '-' || v_group.location_id
    FROM supply_chain.vendors v
    WHERE v.id = v_group.vendor_id AND v.tenant_id = p_tenant_id
    ON CONFLICT (tenant_id, last_event_id) DO NOTHING
    RETURNING id INTO v_po_id;

    IF v_po_id IS NULL THEN
      v_skipped := v_skipped + 1;  -- already created by this run id
      CONTINUE;
    END IF;

    v_line_number := 0;
    v_po_total := 0;

    FOR v_sugg IN
      SELECT rs.catalog_item_id, rs.suggested_order_qty, rs.estimated_unit_cost
      FROM inventory.v_reorder_suggestions rs
      WHERE rs.tenant_id = p_tenant_id
        AND rs.preferred_vendor_id = v_group.vendor_id
        AND rs.location_id = v_group.location_id
        AND rs.suggested_order_qty > 0
        AND NOT EXISTS (
          SELECT 1
          FROM supply_chain.purchase_order_lines pol
          JOIN supply_chain.purchase_orders po ON po.id = pol.po_id
          WHERE po.tenant_id = p_tenant_id
            AND po.id <> v_po_id
            AND pol.catalog_item_id = rs.catalog_item_id
            AND po.status NOT IN ('cancelled', 'voided', 'closed', 'fully_received')
        )
      ORDER BY rs.catalog_item_id
    LOOP
      v_line_number := v_line_number + 1;
      INSERT INTO supply_chain.purchase_order_lines (
        tenant_id, po_id, line_number, catalog_item_id,
        qty_ordered, unit_cost, estimated_unit_cost, status, last_event_id
      ) VALUES (
        p_tenant_id, v_po_id, v_line_number, v_sugg.catalog_item_id,
        v_sugg.suggested_order_qty, v_sugg.estimated_unit_cost, v_sugg.estimated_unit_cost,
        'pending',
        'auto-reorder-' || v_run || '-' || v_po_id || '-' || v_line_number
      )
      ON CONFLICT (tenant_id, last_event_id) DO NOTHING;

      v_po_total := v_po_total
        + v_sugg.suggested_order_qty * COALESCE(v_sugg.estimated_unit_cost, 0);
    END LOOP;

    -- All of this group's items were claimed by an earlier PO in this run
    -- (same item suggested at several locations) — drop the empty shell.
    IF v_line_number = 0 THEN
      DELETE FROM supply_chain.purchase_orders WHERE id = v_po_id;
      CONTINUE;
    END IF;

    -- Route the finished draft into the approval inbox so a human sees it and
    -- approves/tweaks it. Agent-originated restock always needs sign-off — no
    -- vendor email is sent here regardless of the outcome.
    v_approver := supply_chain.resolve_po_approver(
      p_tenant_id, v_fallback_user, v_group.location_id);
    -- last_event_id is deliberately left as the 'auto-reorder-{run}-…' key:
    -- it is the idempotency guard that lets a same-day rerun skip this group.
    UPDATE supply_chain.purchase_orders
    SET status = 'awaiting_approval',
        approval_reason = 'AI restock draft — nightly reorder (run ' || v_run || ')',
        approver_user_id = v_approver
    WHERE id = v_po_id;

    v_created := v_created || jsonb_build_object(
      'po_id', v_po_id,
      'po_number', v_po_number,
      'vendor_id', v_group.vendor_id,
      'location_id', v_group.location_id,
      'line_count', v_line_number,
      'estimated_total', v_po_total,
      'origin', 'auto_reorder',
      'status', 'awaiting_approval'
    );
  END LOOP;

  RETURN jsonb_build_object(
    'run_id', v_run,
    'created', v_created,
    'created_count', jsonb_array_length(v_created),
    'skipped_existing', v_skipped
  );
END;
$$;
