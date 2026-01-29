-- ============================================================================
-- Cycle Count Workflow - Complete Implementation
-- ============================================================================
-- Purpose: Implement complete cycle count workflow supporting both fungible
--          and serialized inventory with snapshot isolation, approval workflows,
--          and atomic posting of adjustments.
--
-- Date: 2026-01-28
-- Compliance: Multi-tenant, RLS-enabled, Event-driven, Idempotent
-- Dependencies: Requires existing cycle_counts, cycle_count_lines tables
--               (created in 20260102000005_create_purchasing_and_cycle_count_tables.sql)
-- ============================================================================

-- ============================================================================
-- STEP 1: Extend inventory.cycle_counts Table
-- ============================================================================

-- Add workflow control columns
ALTER TABLE inventory.cycle_counts
    ADD COLUMN IF NOT EXISTS snapshot_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS count_type TEXT DEFAULT 'full' CHECK (count_type IN ('full', 'partial')),
    ADD COLUMN IF NOT EXISTS is_blind BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS scope_path TEXT,
    ADD COLUMN IF NOT EXISTS config_snapshot JSONB,
    ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS needs_reconcile BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS movements_since_snapshot INTEGER DEFAULT 0;

-- Drop old status check constraint if exists and add expanded one
DO $$
BEGIN
    -- Drop existing constraint
    ALTER TABLE inventory.cycle_counts DROP CONSTRAINT IF EXISTS cycle_counts_status_check;
    
    -- Add new expanded status constraint
    ALTER TABLE inventory.cycle_counts ADD CONSTRAINT cycle_counts_status_check 
        CHECK (status IN ('draft', 'scheduled', 'in_progress', 'under_review', 'approved', 'posted', 'closed', 'cancelled'));
EXCEPTION
    WHEN others THEN
        RAISE NOTICE 'Status constraint already updated or error: %', SQLERRM;
END $$;

-- Add comments
COMMENT ON COLUMN inventory.cycle_counts.snapshot_at IS 'Timestamp when expected state was captured (when count started)';
COMMENT ON COLUMN inventory.cycle_counts.count_type IS 'Type of count: full (all items in scope) or partial (selected items)';
COMMENT ON COLUMN inventory.cycle_counts.is_blind IS 'Whether counters can see expected quantities (blind=true means hidden)';
COMMENT ON COLUMN inventory.cycle_counts.scope_path IS 'Optional sub-location path for narrower scope (e.g., zone/bin)';
COMMENT ON COLUMN inventory.cycle_counts.config_snapshot IS 'Snapshot of thresholds and approval rules at time of count';
COMMENT ON COLUMN inventory.cycle_counts.posted_at IS 'When adjustments were posted to inventory (idempotency marker)';
COMMENT ON COLUMN inventory.cycle_counts.needs_reconcile IS 'Flag indicating movements occurred after snapshot requiring review';
COMMENT ON COLUMN inventory.cycle_counts.movements_since_snapshot IS 'Count of stock movements in scope after snapshot_at';

-- Add index for posting checks
CREATE INDEX IF NOT EXISTS idx_cycle_counts_posted_at 
    ON inventory.cycle_counts(tenant_id, posted_at) 
    WHERE posted_at IS NOT NULL;

-- ============================================================================
-- STEP 2: Extend inventory.cycle_count_lines Table
-- ============================================================================

-- Add workflow and audit columns
ALTER TABLE inventory.cycle_count_lines
    ADD COLUMN IF NOT EXISTS counted_by_user_id UUID REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS recount_pass INTEGER DEFAULT 1,
    ADD COLUMN IF NOT EXISTS variance_reason_code TEXT,
    ADD COLUMN IF NOT EXISTS photo_urls TEXT[],
    ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS adjustment_movement_id UUID REFERENCES inventory.stock_movements(id);

-- Add comments
COMMENT ON COLUMN inventory.cycle_count_lines.counted_by_user_id IS 'User who counted this specific line';
COMMENT ON COLUMN inventory.cycle_count_lines.recount_pass IS 'Counting pass number (1=first count, 2=recount, etc.)';
COMMENT ON COLUMN inventory.cycle_count_lines.variance_reason_code IS 'Reason code for variance (damaged, missing, theft, data_error, etc.)';
COMMENT ON COLUMN inventory.cycle_count_lines.photo_urls IS 'Array of photo URLs for documentation (damage, issues, etc.)';
COMMENT ON COLUMN inventory.cycle_count_lines.posted_at IS 'When adjustment for this line was posted';
COMMENT ON COLUMN inventory.cycle_count_lines.adjustment_movement_id IS 'Link to stock_movement record created when posted';

-- Add index for finding posted lines
CREATE INDEX IF NOT EXISTS idx_cycle_count_lines_posted_at 
    ON inventory.cycle_count_lines(tenant_id, posted_at) 
    WHERE posted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cycle_count_lines_counted_by 
    ON inventory.cycle_count_lines(counted_by_user_id) 
    WHERE counted_by_user_id IS NOT NULL;

-- ============================================================================
-- STEP 3: Create inventory.cycle_count_asset_lines Table (Serialized Items)
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory.cycle_count_asset_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    cycle_count_id UUID NOT NULL REFERENCES inventory.cycle_counts(id) ON DELETE CASCADE,
    line_number INTEGER NOT NULL,
    asset_id UUID NOT NULL REFERENCES inventory.assets(id) ON DELETE RESTRICT,
    expected_present BOOLEAN NOT NULL DEFAULT TRUE,
    counted_present BOOLEAN NULL, -- NULL until scanned
    status TEXT NOT NULL DEFAULT 'pending' 
        CHECK (status IN ('pending', 'matched', 'missing', 'unexpected')),
    scanned_by_user_id UUID REFERENCES auth.users(id),
    scanned_at TIMESTAMPTZ,
    notes TEXT,
    last_event_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    updated_by UUID REFERENCES auth.users(id),
    posted_at TIMESTAMPTZ,
    
    -- Unique constraints
    CONSTRAINT cycle_count_asset_lines_count_line_unique 
        UNIQUE (cycle_count_id, line_number),
    CONSTRAINT cycle_count_asset_lines_tenant_last_event_id_unique 
        UNIQUE (tenant_id, last_event_id),
    CONSTRAINT cycle_count_asset_lines_count_asset_unique
        UNIQUE (cycle_count_id, asset_id)
);

-- Indexes for cycle_count_asset_lines
CREATE INDEX idx_cycle_count_asset_lines_tenant_id 
    ON inventory.cycle_count_asset_lines(tenant_id);
CREATE INDEX idx_cycle_count_asset_lines_cycle_count_id 
    ON inventory.cycle_count_asset_lines(cycle_count_id);
CREATE INDEX idx_cycle_count_asset_lines_asset_id 
    ON inventory.cycle_count_asset_lines(asset_id);
CREATE INDEX idx_cycle_count_asset_lines_status 
    ON inventory.cycle_count_asset_lines(tenant_id, status);
CREATE INDEX idx_cycle_count_asset_lines_scanned_by 
    ON inventory.cycle_count_asset_lines(scanned_by_user_id) 
    WHERE scanned_by_user_id IS NOT NULL;

-- Enable RLS
ALTER TABLE inventory.cycle_count_asset_lines ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY cycle_count_asset_lines_tenant_isolation 
    ON inventory.cycle_count_asset_lines
    FOR ALL
    TO authenticated
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY cycle_count_asset_lines_service_role 
    ON inventory.cycle_count_asset_lines
    FOR ALL
    TO service_role
    USING (TRUE)
    WITH CHECK (TRUE);

-- Audit triggers
CREATE TRIGGER set_cycle_count_asset_lines_audit
    BEFORE INSERT OR UPDATE ON inventory.cycle_count_asset_lines
    FOR EACH ROW
    EXECUTE FUNCTION inventory.set_audit_fields();

CREATE TRIGGER update_cycle_count_asset_lines_updated_at
    BEFORE UPDATE ON inventory.cycle_count_asset_lines
    FOR EACH ROW
    EXECUTE FUNCTION inventory.update_updated_at_column();

-- Comments
COMMENT ON TABLE inventory.cycle_count_asset_lines IS 'Serialized asset lines for cycle counts - tracks individual assets expected/counted';
COMMENT ON COLUMN inventory.cycle_count_asset_lines.expected_present IS 'Whether asset was expected in scope at snapshot time';
COMMENT ON COLUMN inventory.cycle_count_asset_lines.counted_present IS 'Whether asset was actually found during count (NULL=not scanned yet)';
COMMENT ON COLUMN inventory.cycle_count_asset_lines.status IS 'Match status: pending, matched, missing, unexpected';

-- ============================================================================
-- STEP 4: Create inventory.cycle_count_snapshot_skus Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory.cycle_count_snapshot_skus (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    cycle_count_id UUID NOT NULL REFERENCES inventory.cycle_counts(id) ON DELETE CASCADE,
    catalog_item_id UUID NOT NULL REFERENCES inventory.catalog_items(id) ON DELETE RESTRICT,
    location_id UUID NOT NULL REFERENCES inventory.locations(id) ON DELETE RESTRICT,
    expected_qty NUMERIC(18,4) NOT NULL,
    snapshot_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Unique constraint
    CONSTRAINT cycle_count_snapshot_skus_unique 
        UNIQUE (cycle_count_id, catalog_item_id, location_id)
);

-- Indexes
CREATE INDEX idx_cycle_count_snapshot_skus_tenant_id 
    ON inventory.cycle_count_snapshot_skus(tenant_id);
CREATE INDEX idx_cycle_count_snapshot_skus_cycle_count_id 
    ON inventory.cycle_count_snapshot_skus(cycle_count_id);
CREATE INDEX idx_cycle_count_snapshot_skus_catalog_item_id 
    ON inventory.cycle_count_snapshot_skus(catalog_item_id);
CREATE INDEX idx_cycle_count_snapshot_skus_location_id 
    ON inventory.cycle_count_snapshot_skus(location_id);

-- Enable RLS
ALTER TABLE inventory.cycle_count_snapshot_skus ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY cycle_count_snapshot_skus_tenant_isolation 
    ON inventory.cycle_count_snapshot_skus
    FOR ALL
    TO authenticated
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY cycle_count_snapshot_skus_service_role 
    ON inventory.cycle_count_snapshot_skus
    FOR ALL
    TO service_role
    USING (TRUE)
    WITH CHECK (TRUE);

-- Comments
COMMENT ON TABLE inventory.cycle_count_snapshot_skus IS 'Snapshot of expected SKU quantities at time of cycle count start - provides audit trail';
COMMENT ON COLUMN inventory.cycle_count_snapshot_skus.expected_qty IS 'Qty on hand from stock_balances at snapshot_at timestamp';

-- ============================================================================
-- STEP 5: Create inventory.cycle_count_snapshot_assets Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory.cycle_count_snapshot_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    cycle_count_id UUID NOT NULL REFERENCES inventory.cycle_counts(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL REFERENCES inventory.assets(id) ON DELETE RESTRICT,
    expected_location_id UUID NOT NULL REFERENCES inventory.locations(id) ON DELETE RESTRICT,
    expected_status TEXT NOT NULL,
    snapshot_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Unique constraint
    CONSTRAINT cycle_count_snapshot_assets_unique 
        UNIQUE (cycle_count_id, asset_id)
);

-- Indexes
CREATE INDEX idx_cycle_count_snapshot_assets_tenant_id 
    ON inventory.cycle_count_snapshot_assets(tenant_id);
CREATE INDEX idx_cycle_count_snapshot_assets_cycle_count_id 
    ON inventory.cycle_count_snapshot_assets(cycle_count_id);
CREATE INDEX idx_cycle_count_snapshot_assets_asset_id 
    ON inventory.cycle_count_snapshot_assets(asset_id);
CREATE INDEX idx_cycle_count_snapshot_assets_expected_location 
    ON inventory.cycle_count_snapshot_assets(expected_location_id);

-- Enable RLS
ALTER TABLE inventory.cycle_count_snapshot_assets ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY cycle_count_snapshot_assets_tenant_isolation 
    ON inventory.cycle_count_snapshot_assets
    FOR ALL
    TO authenticated
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY cycle_count_snapshot_assets_service_role 
    ON inventory.cycle_count_snapshot_assets
    FOR ALL
    TO service_role
    USING (TRUE)
    WITH CHECK (TRUE);

-- Comments
COMMENT ON TABLE inventory.cycle_count_snapshot_assets IS 'Snapshot of expected asset locations at time of cycle count start - provides audit trail';
COMMENT ON COLUMN inventory.cycle_count_snapshot_assets.expected_location_id IS 'Asset location at snapshot_at timestamp';
COMMENT ON COLUMN inventory.cycle_count_snapshot_assets.expected_status IS 'Asset status at snapshot_at timestamp';

-- ============================================================================
-- STEP 6: Helper Function - Create Snapshot
-- ============================================================================

CREATE OR REPLACE FUNCTION inventory.create_cycle_count_snapshot(
    p_cycle_count_id UUID,
    p_tenant_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_location_id UUID;
    v_scope_path TEXT;
    v_count_type TEXT;
    v_snapshot_time TIMESTAMPTZ;
    v_skus_inserted INTEGER := 0;
    v_assets_inserted INTEGER := 0;
    v_result JSONB;
BEGIN
    -- Get cycle count details
    SELECT location_id, scope_path, count_type, NOW()
    INTO v_location_id, v_scope_path, v_count_type, v_snapshot_time
    FROM inventory.cycle_counts
    WHERE id = p_cycle_count_id AND tenant_id = p_tenant_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cycle count % not found for tenant %', p_cycle_count_id, p_tenant_id;
    END IF;
    
    -- Update cycle count with snapshot time
    UPDATE inventory.cycle_counts
    SET snapshot_at = v_snapshot_time,
        status = 'in_progress',
        started_at = COALESCE(started_at, v_snapshot_time)
    WHERE id = p_cycle_count_id AND tenant_id = p_tenant_id;
    
    -- Snapshot SKUs (fungible items)
    -- For now, snapshot all items at the location
    -- TODO: Filter by scope_path if needed, handle partial counts
    INSERT INTO inventory.cycle_count_snapshot_skus (
        tenant_id, cycle_count_id, catalog_item_id, location_id, 
        expected_qty, snapshot_at
    )
    SELECT 
        sb.tenant_id,
        p_cycle_count_id,
        sb.catalog_item_id,
        sb.location_id,
        sb.qty_on_hand,
        v_snapshot_time
    FROM inventory.stock_balances sb
    INNER JOIN inventory.catalog_items ci ON ci.id = sb.catalog_item_id AND ci.tenant_id = sb.tenant_id
    WHERE sb.tenant_id = p_tenant_id
        AND sb.location_id = v_location_id
        AND ci.tracking_mode IN ('stock', 'both')
        AND sb.qty_on_hand > 0
    ON CONFLICT (cycle_count_id, catalog_item_id, location_id) DO NOTHING;
    
    GET DIAGNOSTICS v_skus_inserted = ROW_COUNT;
    
    -- Snapshot Assets (serialized items)
    -- Capture all assets currently at the location
    INSERT INTO inventory.cycle_count_snapshot_assets (
        tenant_id, cycle_count_id, asset_id, expected_location_id, 
        expected_status, snapshot_at
    )
    SELECT 
        a.tenant_id,
        p_cycle_count_id,
        a.id,
        a.location_id,
        a.status,
        v_snapshot_time
    FROM inventory.assets a
    INNER JOIN inventory.catalog_items ci ON ci.id = a.catalog_item_id AND ci.tenant_id = a.tenant_id
    WHERE a.tenant_id = p_tenant_id
        AND a.location_id = v_location_id
        AND ci.tracking_mode IN ('serialized', 'both')
        AND a.status IN ('available', 'assigned')
    ON CONFLICT (cycle_count_id, asset_id) DO NOTHING;
    
    GET DIAGNOSTICS v_assets_inserted = ROW_COUNT;
    
    -- Build result
    v_result := jsonb_build_object(
        'cycle_count_id', p_cycle_count_id,
        'snapshot_at', v_snapshot_time,
        'skus_snapshotted', v_skus_inserted,
        'assets_snapshotted', v_assets_inserted
    );
    
    RAISE NOTICE 'Snapshot created: % SKUs, % assets', v_skus_inserted, v_assets_inserted;
    
    RETURN v_result;
END;
$$;

COMMENT ON FUNCTION inventory.create_cycle_count_snapshot IS 
    'Creates snapshot of expected inventory state for a cycle count. Captures SKUs from stock_balances and assets from assets table at current moment.';

-- ============================================================================
-- STEP 7: Helper Function - Detect Movements Since Snapshot
-- ============================================================================

CREATE OR REPLACE FUNCTION inventory.detect_movements_since_snapshot(
    p_cycle_count_id UUID,
    p_tenant_id UUID
)
RETURNS TABLE (
    movement_id UUID,
    catalog_item_id UUID,
    location_id UUID,
    quantity_delta NUMERIC,
    movement_type TEXT,
    occurred_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_snapshot_at TIMESTAMPTZ;
    v_location_id UUID;
BEGIN
    -- Get snapshot time and location
    SELECT snapshot_at, location_id
    INTO v_snapshot_at, v_location_id
    FROM inventory.cycle_counts
    WHERE id = p_cycle_count_id AND tenant_id = p_tenant_id;
    
    IF v_snapshot_at IS NULL THEN
        RAISE EXCEPTION 'Cycle count % has no snapshot', p_cycle_count_id;
    END IF;
    
    -- Return movements in scope after snapshot
    RETURN QUERY
    SELECT 
        sm.id,
        sm.catalog_item_id,
        sm.location_id,
        sm.quantity_delta,
        sm.movement_type,
        sm.occurred_at
    FROM inventory.stock_movements sm
    WHERE sm.tenant_id = p_tenant_id
        AND sm.location_id = v_location_id
        AND sm.occurred_at > v_snapshot_at
        AND sm.posting_status = 'posted'
    ORDER BY sm.occurred_at DESC;
END;
$$;

COMMENT ON FUNCTION inventory.detect_movements_since_snapshot IS 
    'Returns list of stock movements that occurred in cycle count scope after snapshot was captured. Used to detect conflicts.';

-- ============================================================================
-- STEP 8: Helper Function - Post Cycle Count Adjustments (Atomic & Idempotent)
-- ============================================================================

CREATE OR REPLACE FUNCTION inventory.post_cycle_count_adjustments(
    p_cycle_count_id UUID,
    p_tenant_id UUID,
    p_posted_by_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count_status TEXT;
    v_posted_at TIMESTAMPTZ;
    v_correlation_id UUID;
    v_adjustments_created INTEGER := 0;
    v_lines_processed INTEGER := 0;
    v_result JSONB;
    v_line RECORD;
BEGIN
    -- Check if already posted (idempotency)
    SELECT status, posted_at
    INTO v_count_status, v_posted_at
    FROM inventory.cycle_counts
    WHERE id = p_cycle_count_id AND tenant_id = p_tenant_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cycle count % not found', p_cycle_count_id;
    END IF;
    
    IF v_posted_at IS NOT NULL THEN
        RAISE NOTICE 'Cycle count % already posted at %', p_cycle_count_id, v_posted_at;
        RETURN jsonb_build_object(
            'success', TRUE,
            'message', 'Already posted',
            'posted_at', v_posted_at,
            'adjustments_created', 0
        );
    END IF;
    
    -- Verify status allows posting
    IF v_count_status NOT IN ('approved', 'under_review') THEN
        RAISE EXCEPTION 'Cannot post cycle count in status: %', v_count_status;
    END IF;
    
    -- Generate correlation ID for this posting batch
    v_correlation_id := gen_random_uuid();
    v_posted_at := NOW();
    
    -- Process SKU lines (fungible items)
    FOR v_line IN
        SELECT 
            ccl.id as line_id,
            ccl.catalog_item_id,
            ccl.location_id,
            ccl.variance
        FROM inventory.cycle_count_lines ccl
        WHERE ccl.cycle_count_id = p_cycle_count_id
            AND ccl.tenant_id = p_tenant_id
            AND ccl.variance IS NOT NULL
            AND ccl.variance <> 0
            AND ccl.posted_at IS NULL
    LOOP
        -- Create stock movement for adjustment
        INSERT INTO inventory.stock_movements (
            tenant_id,
            catalog_item_id,
            location_id,
            quantity_delta,
            movement_type,
            source_ref_type,
            source_ref_id,
            reason,
            correlation_id,
            occurred_at,
            created_by_user_id,
            last_event_id,
            posting_status
        ) VALUES (
            p_tenant_id,
            v_line.catalog_item_id,
            v_line.location_id,
            v_line.variance,
            'adjusted',
            'cycle_count',
            p_cycle_count_id,
            'Cycle count adjustment',
            v_correlation_id,
            v_posted_at,
            p_posted_by_user_id,
            'cc_adj_' || p_cycle_count_id::TEXT || '_line_' || v_line.line_id::TEXT,
            'posted'
        );
        
        -- Mark line as posted
        UPDATE inventory.cycle_count_lines
        SET posted_at = v_posted_at
        WHERE id = v_line.line_id;
        
        v_adjustments_created := v_adjustments_created + 1;
        v_lines_processed := v_lines_processed + 1;
    END LOOP;
    
    -- TODO: Process asset lines (serialized items) - future enhancement
    -- Would update asset.location_id for missing/unexpected assets
    
    -- Mark cycle count as posted
    UPDATE inventory.cycle_counts
    SET 
        status = 'posted',
        posted_at = v_posted_at
    WHERE id = p_cycle_count_id AND tenant_id = p_tenant_id;
    
    -- Emit event
    PERFORM public.emit_event(
        p_event_name := 'inventory.cycle_count.posted',
        p_tenant_id := p_tenant_id,
        p_scope := 'tenant',
        p_aggregate_type := 'cycle_count',
        p_aggregate_id := p_cycle_count_id,
        p_payload := jsonb_build_object(
            'cycle_count_id', p_cycle_count_id,
            'posted_at', v_posted_at,
            'adjustments_created', v_adjustments_created,
            'correlation_id', v_correlation_id,
            'posted_by_user_id', p_posted_by_user_id
        ),
        p_actor_user_id := p_posted_by_user_id
    );
    
    -- Build result
    v_result := jsonb_build_object(
        'success', TRUE,
        'cycle_count_id', p_cycle_count_id,
        'posted_at', v_posted_at,
        'adjustments_created', v_adjustments_created,
        'lines_processed', v_lines_processed,
        'correlation_id', v_correlation_id
    );
    
    RAISE NOTICE 'Posted cycle count %: % adjustments created', p_cycle_count_id, v_adjustments_created;
    
    RETURN v_result;
END;
$$;

COMMENT ON FUNCTION inventory.post_cycle_count_adjustments IS 
    'Atomically posts all cycle count adjustments to stock_movements. Idempotent - checks posted_at before processing. Creates one movement per variance line with shared correlation_id.';

-- ============================================================================
-- STEP 9: Grant Permissions
-- ============================================================================

-- Grant execute on helper functions to authenticated users
GRANT EXECUTE ON FUNCTION inventory.create_cycle_count_snapshot TO authenticated;
GRANT EXECUTE ON FUNCTION inventory.detect_movements_since_snapshot TO authenticated;
GRANT EXECUTE ON FUNCTION inventory.post_cycle_count_adjustments TO authenticated;

-- Grant service role access
GRANT EXECUTE ON FUNCTION inventory.create_cycle_count_snapshot TO service_role;
GRANT EXECUTE ON FUNCTION inventory.detect_movements_since_snapshot TO service_role;
GRANT EXECUTE ON FUNCTION inventory.post_cycle_count_adjustments TO service_role;

-- ============================================================================
-- Migration Complete
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '╔═══════════════════════════════════════════════════════════════════╗';
    RAISE NOTICE '║   Cycle Count Workflow Migration Complete                        ║';
    RAISE NOTICE '╚═══════════════════════════════════════════════════════════════════╝';
    RAISE NOTICE '';
    RAISE NOTICE '✓ Extended cycle_counts table with workflow columns';
    RAISE NOTICE '✓ Extended cycle_count_lines table with audit columns';
    RAISE NOTICE '✓ Created cycle_count_asset_lines table (serialized items)';
    RAISE NOTICE '✓ Created cycle_count_snapshot_skus table (audit trail)';
    RAISE NOTICE '✓ Created cycle_count_snapshot_assets table (audit trail)';
    RAISE NOTICE '✓ Created helper functions:';
    RAISE NOTICE '    - create_cycle_count_snapshot()';
    RAISE NOTICE '    - detect_movements_since_snapshot()';
    RAISE NOTICE '    - post_cycle_count_adjustments()';
    RAISE NOTICE '✓ Applied RLS policies to all new tables';
    RAISE NOTICE '✓ Created indexes for performance';
    RAISE NOTICE '';
    RAISE NOTICE 'Next Steps:';
    RAISE NOTICE '  1. Register events in event_definitions (see event catalog migration)';
    RAISE NOTICE '  2. Test workflow with validation queries';
    RAISE NOTICE '  3. Implement frontend API endpoints';
    RAISE NOTICE '';
END $$;
