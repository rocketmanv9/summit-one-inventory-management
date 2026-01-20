-- ============================================================================
-- PHASE 6: CYCLE COUNT RPCs
-- ============================================================================
-- Start/count/approve/post workflow

-- =====================================================
-- Start Cycle Count
-- =====================================================
CREATE OR REPLACE FUNCTION inventory.rpc_inv_cycle_count_start(
    p_tenant_id UUID,
    p_location_id UUID,
    p_count_type TEXT,
    p_catalog_item_ids UUID[] DEFAULT NULL,
    p_item_category_id UUID DEFAULT NULL,
    p_counted_by_user_id UUID DEFAULT NULL,
    p_last_event_id TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count_id UUID;
    v_event_id TEXT;
    v_item RECORD;
BEGIN
    v_event_id := COALESCE(p_last_event_id, 'count_start_' || gen_random_uuid()::TEXT);
    
    -- Validate count_type
    IF p_count_type NOT IN ('full', 'partial', 'spot_check') THEN
        RAISE EXCEPTION 'Invalid count_type. Must be: full, partial, spot_check';
    END IF;
    
    -- Create count header
    INSERT INTO inventory.cycle_counts (
        tenant_id,
        location_id,
        count_type,
        status,
        counted_by_user_id,
        last_event_id
    ) VALUES (
        p_tenant_id,
        p_location_id,
        p_count_type,
        'in_progress',
        p_counted_by_user_id,
        v_event_id
    )
    ON CONFLICT (tenant_id, last_event_id) DO NOTHING
    RETURNING id INTO v_count_id;
    
    IF v_count_id IS NULL THEN
        SELECT id INTO v_count_id
        FROM inventory.cycle_counts
        WHERE tenant_id = p_tenant_id AND last_event_id = v_event_id;
        RETURN v_count_id;
    END IF;
    
    -- Create count lines based on type
    IF p_count_type = 'full' THEN
        -- All items in location
        INSERT INTO inventory.cycle_count_lines (
            tenant_id,
            cycle_count_id,
            catalog_item_id,
            expected_qty,
            last_event_id
        )
        SELECT 
            sb.tenant_id,
            v_count_id,
            sb.catalog_item_id,
            sb.qty_on_hand,
            v_event_id || '_line_' || sb.catalog_item_id::TEXT
        FROM inventory.stock_balances sb
        WHERE sb.tenant_id = p_tenant_id
        AND sb.location_id = p_location_id
        AND sb.qty_on_hand > 0
        ON CONFLICT (tenant_id, last_event_id) DO NOTHING;
        
    ELSIF p_count_type = 'partial' THEN
        -- Specific items or category
        IF p_catalog_item_ids IS NOT NULL THEN
            INSERT INTO inventory.cycle_count_lines (
                tenant_id,
                cycle_count_id,
                catalog_item_id,
                expected_qty,
                last_event_id
            )
            SELECT 
                sb.tenant_id,
                v_count_id,
                sb.catalog_item_id,
                sb.qty_on_hand,
                v_event_id || '_line_' || sb.catalog_item_id::TEXT
            FROM inventory.stock_balances sb
            WHERE sb.tenant_id = p_tenant_id
            AND sb.location_id = p_location_id
            AND sb.catalog_item_id = ANY(p_catalog_item_ids)
            ON CONFLICT (tenant_id, last_event_id) DO NOTHING;
        ELSIF p_item_category_id IS NOT NULL THEN
            INSERT INTO inventory.cycle_count_lines (
                tenant_id,
                cycle_count_id,
                catalog_item_id,
                expected_qty,
                last_event_id
            )
            SELECT 
                sb.tenant_id,
                v_count_id,
                sb.catalog_item_id,
                sb.qty_on_hand,
                v_event_id || '_line_' || sb.catalog_item_id::TEXT
            FROM inventory.stock_balances sb
            JOIN inventory.catalog_items ci ON ci.id = sb.catalog_item_id
            WHERE sb.tenant_id = p_tenant_id
            AND sb.location_id = p_location_id
            AND ci.item_category_id = p_item_category_id
            ON CONFLICT (tenant_id, last_event_id) DO NOTHING;
        ELSE
            RAISE EXCEPTION 'Partial count requires catalog_item_ids or item_category_id';
        END IF;
    END IF;
    
    -- Publish event
    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id,
        p_scope => 'inventory',
        p_event_type => 'cycle_count.started',
        p_aggregate_type => 'cycle_count',
        p_aggregate_id => v_count_id,
        p_payload => jsonb_build_object(
            'cycle_count_id', v_count_id,
            'location_id', p_location_id,
            'count_type', p_count_type
        )
    );
    
    RETURN v_count_id;
END;
$$;

COMMENT ON FUNCTION inventory.rpc_inv_cycle_count_start IS 
    'Starts new cycle count and creates lines based on count type';

-- =====================================================
-- Record Count
-- =====================================================
CREATE OR REPLACE FUNCTION inventory.rpc_inv_cycle_count_record(
    p_tenant_id UUID,
    p_cycle_count_id UUID,
    p_catalog_item_id UUID,
    p_counted_qty NUMERIC,
    p_last_event_id TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count RECORD;
    v_line RECORD;
    v_item RECORD;
    v_requires_approval BOOLEAN;
    v_variance_qty NUMERIC;
    v_variance_pct NUMERIC;
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
    v_variance_qty := p_counted_qty - v_line.expected_qty;
    IF v_line.expected_qty = 0 THEN
        v_variance_pct := NULL;
    ELSE
        v_variance_pct := (v_variance_qty / v_line.expected_qty) * 100;
    END IF;
    
    -- Check if approval required
    v_requires_approval := inventory.check_variance_approval(
        p_tenant_id => p_tenant_id,
        p_catalog_item_id => p_catalog_item_id,
        p_location_id => v_count.location_id,
        p_item_category_id => v_item.item_category_id,
        p_variance_qty => v_variance_qty,
        p_expected_qty => v_line.expected_qty
    );
    
    -- Update line
    UPDATE inventory.cycle_count_lines
    SET 
        counted_qty = p_counted_qty,
        variance_qty = v_variance_qty,
        variance_pct = v_variance_pct,
        requires_approval = v_requires_approval,
        auto_approved = NOT v_requires_approval,
        counted_at = NOW(),
        updated_at = NOW()
    WHERE id = v_line.id;
    
    RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION inventory.rpc_inv_cycle_count_record IS 
    'Records counted quantity and calculates variance';

-- =====================================================
-- Approve Count
-- =====================================================
CREATE OR REPLACE FUNCTION inventory.rpc_inv_cycle_count_approve(
    p_tenant_id UUID,
    p_cycle_count_id UUID,
    p_approved_by_user_id UUID,
    p_approval_notes TEXT DEFAULT NULL,
    p_last_event_id TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count RECORD;
    v_pending_lines INTEGER;
BEGIN
    -- Get count
    SELECT * INTO v_count
    FROM inventory.cycle_counts
    WHERE id = p_cycle_count_id AND tenant_id = p_tenant_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cycle count not found';
    END IF;
    
    IF v_count.status != 'pending_approval' THEN
        RAISE EXCEPTION 'Count is not pending approval';
    END IF;
    
    -- Check for uncounted lines
    SELECT COUNT(*) INTO v_pending_lines
    FROM inventory.cycle_count_lines
    WHERE cycle_count_id = p_cycle_count_id
    AND counted_qty IS NULL;
    
    IF v_pending_lines > 0 THEN
        RAISE EXCEPTION '% lines have not been counted', v_pending_lines;
    END IF;
    
    -- Approve
    UPDATE inventory.cycle_counts
    SET 
        status = 'approved',
        approved_by_user_id = p_approved_by_user_id,
        approved_at = NOW(),
        approval_notes = p_approval_notes,
        updated_at = NOW()
    WHERE id = p_cycle_count_id;
    
    -- Publish event
    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id,
        p_scope => 'inventory',
        p_event_type => 'cycle_count.approved',
        p_aggregate_type => 'cycle_count',
        p_aggregate_id => p_cycle_count_id,
        p_payload => jsonb_build_object(
            'cycle_count_id', p_cycle_count_id,
            'approved_by_user_id', p_approved_by_user_id
        )
    );
    
    RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION inventory.rpc_inv_cycle_count_approve IS 
    'Approves cycle count for posting';

DO $$ BEGIN
    RAISE NOTICE '✅ Cycle count RPCs created';
END $$;

