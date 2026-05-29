-- Fix inventory.rpc_inv_cycle_count_record: it referenced columns that do not
-- exist on the current schema, so EVERY mobile/desktop count-record call threw
-- and qty_counted was never persisted (counts silently lost, nothing posted to
-- stock on approval).
--
-- Wrong -> correct column references:
--   v_line.expected_qty      -> v_line.qty_expected
--   v_item.item_category_id  -> v_item.category_id   (catalog_items uses category_id)
--   SET counted_qty = ...    -> SET qty_counted = ...
--
-- Note: cycle_count_lines.variance is a GENERATED column
-- (COALESCE(qty_counted,0) - COALESCE(qty_expected,0)) and must NOT be written;
-- it updates automatically once qty_counted is set, and that is the column
-- post_cycle_count_adjustments reads.

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
AS $function$
DECLARE
    v_count RECORD;
    v_line RECORD;
    v_item RECORD;
    v_requires_approval BOOLEAN;
    v_variance_qty NUMERIC;
    v_variance_pct NUMERIC;
    v_expected NUMERIC;
BEGIN
    -- Get count header
    SELECT * INTO v_count
    FROM inventory.cycle_counts
    WHERE id = p_cycle_count_id AND tenant_id = p_tenant_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cycle count not found';
    END IF;

    IF v_count.status != 'in_progress' THEN
        RAISE EXCEPTION 'Count is not in progress';
    END IF;

    -- Get line
    SELECT * INTO v_line
    FROM inventory.cycle_count_lines
    WHERE cycle_count_id = p_cycle_count_id
      AND catalog_item_id = p_catalog_item_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Item not in this count';
    END IF;

    -- Get item details
    SELECT * INTO v_item
    FROM inventory.catalog_items
    WHERE id = p_catalog_item_id;

    -- Calculate variance
    v_expected := COALESCE(v_line.qty_expected, 0);
    v_variance_qty := p_counted_qty - v_expected;
    IF v_expected = 0 THEN
        v_variance_pct := NULL;
    ELSE
        v_variance_pct := (v_variance_qty / v_expected) * 100;
    END IF;

    -- Check if approval required
    v_requires_approval := inventory.check_variance_approval(
        p_tenant_id => p_tenant_id,
        p_catalog_item_id => p_catalog_item_id,
        p_location_id => v_count.location_id,
        p_item_category_id => v_item.category_id,
        p_variance_qty => v_variance_qty,
        p_expected_qty => v_expected
    );

    -- Update line (variance is generated from qty_counted/qty_expected — do not set it)
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
