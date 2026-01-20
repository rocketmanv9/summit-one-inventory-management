-- ============================================================================
-- SUMMIT ONE INVENTORY - PRODUCTION HARDENING MIGRATION
-- ============================================================================
-- Version: 1.0.0
-- Date: 2026-01-16
-- 
-- Purpose: Transform inventory DB into production-ready, AI-assisted system
-- 
-- Key Features:
--   ✓ Ledger-first append-only design
--   ✓ Multi-tenant RLS enforcement
--   ✓ Event idempotency
--   ✓ AI-assist readiness
--   ✓ Safe RPCs for all operations
--   ✓ Read models for frontend
--   ✓ Outbox pattern for events
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION 1: CORE LEDGER (APPEND-ONLY TRUTH)
-- ============================================================================

-- Drop existing movements table if it exists (fresh start)
DROP TABLE IF EXISTS inventory.inventory_movements CASCADE;

-- Create append-only ledger
CREATE TABLE inventory.inventory_movements (
    -- Identity
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    
    -- Movement classification
    movement_type TEXT NOT NULL CHECK (movement_type IN (
        'purchase_receive',    -- Receiving from PO
        'issue_to_job',        -- Issue to job/project
        'return_from_job',     -- Return from job
        'transfer',            -- Between locations
        'adjust',              -- Count adjustment
        'scrap',               -- Write-off/scrap
        'found',               -- Found inventory (positive adjust)
        'assign',              -- Assign to employee/asset
        'unassign',            -- Return from employee/asset
        'reserve',             -- Create reservation
        'release'              -- Release reservation
    )),
    
    -- Core movement data
    quantity_delta NUMERIC(15,4) NOT NULL CHECK (quantity_delta != 0),
    unit_id UUID NOT NULL REFERENCES inventory.units(id),
    item_id UUID NOT NULL REFERENCES inventory.items(id),
    
    -- Location tracking
    from_location_id UUID REFERENCES inventory.locations(id),
    to_location_id UUID REFERENCES inventory.locations(id),
    
    -- Related entities (nullable based on movement_type)
    job_id UUID,
    employee_id UUID,
    vendor_id UUID,
    po_id UUID,
    po_line_id UUID,
    reservation_id UUID,
    parent_movement_id UUID REFERENCES inventory.inventory_movements(id),
    
    -- Reason/audit
    reason_code TEXT,
    reason_text TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- Audit trail
    created_by UUID NOT NULL REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Idempotency (CRITICAL)
    last_event_id UUID UNIQUE,
    
    -- Constraints
    CONSTRAINT valid_locations CHECK (
        -- Transfer must have both locations
        (movement_type = 'transfer' AND from_location_id IS NOT NULL AND to_location_id IS NOT NULL)
        -- Issue must have from_location and job
        OR (movement_type = 'issue_to_job' AND from_location_id IS NOT NULL AND job_id IS NOT NULL)
        -- Return must have to_location and job
        OR (movement_type = 'return_from_job' AND to_location_id IS NOT NULL AND job_id IS NOT NULL)
        -- Purchase receive must have to_location and po info
        OR (movement_type = 'purchase_receive' AND to_location_id IS NOT NULL)
        -- Other types are flexible
        OR movement_type NOT IN ('transfer', 'issue_to_job', 'return_from_job', 'purchase_receive')
    )
);

-- Indexes for performance
CREATE INDEX idx_movements_tenant_created ON inventory.inventory_movements(tenant_id, created_at DESC);
CREATE INDEX idx_movements_item ON inventory.inventory_movements(tenant_id, item_id, created_at DESC);
CREATE INDEX idx_movements_location_from ON inventory.inventory_movements(tenant_id, from_location_id) WHERE from_location_id IS NOT NULL;
CREATE INDEX idx_movements_location_to ON inventory.inventory_movements(tenant_id, to_location_id) WHERE to_location_id IS NOT NULL;
CREATE INDEX idx_movements_job ON inventory.inventory_movements(tenant_id, job_id) WHERE job_id IS NOT NULL;
CREATE INDEX idx_movements_type ON inventory.inventory_movements(tenant_id, movement_type);
CREATE INDEX idx_movements_idempotency ON inventory.inventory_movements(last_event_id) WHERE last_event_id IS NOT NULL;

-- Prevent modifications to ledger (append-only enforcement)
CREATE OR REPLACE FUNCTION inventory.prevent_movement_modification()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'inventory_movements is append-only. Updates are not allowed. Create a new movement instead.';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'inventory_movements is append-only. Deletes are not allowed. Use adjustment movements to correct.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prevent_movements_modification
    BEFORE UPDATE OR DELETE ON inventory.inventory_movements
    FOR EACH ROW EXECUTE FUNCTION inventory.prevent_movement_modification();

COMMENT ON TABLE inventory.inventory_movements IS 
    'Append-only ledger of all inventory movements. This is the source of truth.';

-- ============================================================================
-- SECTION 2: RESERVATIONS (COMMITTED INVENTORY)
-- ============================================================================

CREATE TABLE IF NOT EXISTS inventory.inventory_reservations (
    -- Identity
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    
    -- What is reserved
    item_id UUID NOT NULL REFERENCES inventory.items(id),
    quantity NUMERIC(15,4) NOT NULL CHECK (quantity > 0),
    unit_id UUID NOT NULL REFERENCES inventory.units(id),
    
    -- Where reserved from
    location_id UUID REFERENCES inventory.locations(id),
    
    -- Why reserved
    reference_type TEXT, -- 'job', 'sales_order', 'work_order'
    reference_id UUID,
    job_id UUID,
    
    -- Status tracking
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
        'active',      -- Currently reserved
        'fulfilled',   -- Consumed/issued
        'canceled',    -- Canceled before use
        'expired'      -- Auto-expired
    )),
    
    -- Dates
    reserved_until TIMESTAMPTZ,
    fulfilled_at TIMESTAMPTZ,
    
    -- Audit
    created_by UUID NOT NULL REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Idempotency
    last_event_id UUID UNIQUE
);

CREATE INDEX idx_reservations_tenant_status ON inventory.inventory_reservations(tenant_id, status);
CREATE INDEX idx_reservations_item_active ON inventory.inventory_reservations(tenant_id, item_id, status) 
    WHERE status = 'active';
CREATE INDEX idx_reservations_location ON inventory.inventory_reservations(tenant_id, location_id) 
    WHERE location_id IS NOT NULL AND status = 'active';
CREATE INDEX idx_reservations_job ON inventory.inventory_reservations(tenant_id, job_id) 
    WHERE job_id IS NOT NULL;

-- ============================================================================
-- SECTION 3: STOCK READ MODEL (MATERIALIZED VIEW APPROACH)
-- ============================================================================

-- Drop existing stock table if present
DROP TABLE IF EXISTS inventory.inventory_stock CASCADE;

-- Create stock snapshot table (updated by triggers)
CREATE TABLE inventory.inventory_stock (
    -- Composite key
    tenant_id UUID NOT NULL,
    item_id UUID NOT NULL REFERENCES inventory.items(id) ON DELETE CASCADE,
    location_id UUID REFERENCES inventory.locations(id) ON DELETE CASCADE,
    
    -- Aggregated quantities
    on_hand_quantity NUMERIC(15,4) NOT NULL DEFAULT 0,
    reserved_quantity NUMERIC(15,4) NOT NULL DEFAULT 0,
    available_quantity NUMERIC(15,4) GENERATED ALWAYS AS (on_hand_quantity - reserved_quantity) STORED,
    
    -- Metadata
    last_movement_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    PRIMARY KEY (tenant_id, item_id, location_id)
);

CREATE INDEX idx_stock_tenant_item ON inventory.inventory_stock(tenant_id, item_id);
CREATE INDEX idx_stock_location ON inventory.inventory_stock(tenant_id, location_id);
CREATE INDEX idx_stock_available ON inventory.inventory_stock(tenant_id, item_id, available_quantity);

-- Trigger to update stock on movement insert
CREATE OR REPLACE FUNCTION inventory.update_stock_on_movement()
RETURNS TRIGGER AS $$
DECLARE
    v_from_location UUID;
    v_to_location UUID;
BEGIN
    v_from_location := NEW.from_location_id;
    v_to_location := NEW.to_location_id;
    
    -- Update FROM location (decrease)
    IF v_from_location IS NOT NULL THEN
        INSERT INTO inventory.inventory_stock (tenant_id, item_id, location_id, on_hand_quantity, last_movement_at)
        VALUES (NEW.tenant_id, NEW.item_id, v_from_location, -NEW.quantity_delta, NEW.created_at)
        ON CONFLICT (tenant_id, item_id, location_id) 
        DO UPDATE SET 
            on_hand_quantity = inventory.inventory_stock.on_hand_quantity - NEW.quantity_delta,
            last_movement_at = NEW.created_at,
            updated_at = NOW();
    END IF;
    
    -- Update TO location (increase)
    IF v_to_location IS NOT NULL THEN
        INSERT INTO inventory.inventory_stock (tenant_id, item_id, location_id, on_hand_quantity, last_movement_at)
        VALUES (NEW.tenant_id, NEW.item_id, v_to_location, NEW.quantity_delta, NEW.created_at)
        ON CONFLICT (tenant_id, item_id, location_id) 
        DO UPDATE SET 
            on_hand_quantity = inventory.inventory_stock.on_hand_quantity + NEW.quantity_delta,
            last_movement_at = NEW.created_at,
            updated_at = NOW();
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_update_stock
    AFTER INSERT ON inventory.inventory_movements
    FOR EACH ROW EXECUTE FUNCTION inventory.update_stock_on_movement();

-- Update reserved quantity on reservation changes
CREATE OR REPLACE FUNCTION inventory.update_reserved_on_reservation()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.status = 'active' THEN
        -- Increase reserved
        UPDATE inventory.inventory_stock
        SET reserved_quantity = reserved_quantity + NEW.quantity,
            updated_at = NOW()
        WHERE tenant_id = NEW.tenant_id 
          AND item_id = NEW.item_id 
          AND location_id = COALESCE(NEW.location_id, (
              SELECT id FROM inventory.locations WHERE tenant_id = NEW.tenant_id LIMIT 1
          ));
    ELSIF TG_OP = 'UPDATE' AND OLD.status = 'active' AND NEW.status != 'active' THEN
        -- Decrease reserved (fulfilled/canceled/expired)
        UPDATE inventory.inventory_stock
        SET reserved_quantity = reserved_quantity - OLD.quantity,
            updated_at = NOW()
        WHERE tenant_id = OLD.tenant_id 
          AND item_id = OLD.item_id 
          AND location_id = COALESCE(OLD.location_id, (
              SELECT id FROM inventory.locations WHERE tenant_id = OLD.tenant_id LIMIT 1
          ));
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_update_reserved
    AFTER INSERT OR UPDATE ON inventory.inventory_reservations
    FOR EACH ROW EXECUTE FUNCTION inventory.update_reserved_on_reservation();

-- ============================================================================
-- SECTION 4: AI-ASSIST LAYER
-- ============================================================================

-- 4A: Item Aliases (for fuzzy matching and AI suggestions)
CREATE TABLE inventory.inventory_item_aliases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    item_id UUID NOT NULL REFERENCES inventory.items(id) ON DELETE CASCADE,
    
    -- Alias data
    alias_text TEXT NOT NULL,
    normalized_alias TEXT GENERATED ALWAYS AS (LOWER(TRIM(alias_text))) STORED,
    confidence NUMERIC(3,2) DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
    
    -- Source tracking
    source TEXT NOT NULL CHECK (source IN ('human', 'import', 'ai_suggested', 'ai_learned')),
    
    -- Audit
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Idempotency
    last_event_id UUID UNIQUE,
    
    UNIQUE (tenant_id, item_id, normalized_alias)
);

CREATE INDEX idx_aliases_tenant_normalized ON inventory.inventory_item_aliases(tenant_id, normalized_alias);
CREATE INDEX idx_aliases_item ON inventory.inventory_item_aliases(tenant_id, item_id);
CREATE INDEX idx_aliases_source ON inventory.inventory_item_aliases(tenant_id, source);

COMMENT ON TABLE inventory.inventory_item_aliases IS 
    'Alternative names/codes for items. Used by AI to match user input to catalog.';

-- 4B: Reason Codes (standardized, tenant-scoped)
CREATE TABLE inventory.inventory_reason_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    
    code TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN (
        'LOSS', 'SCRAP', 'ADJUST_COUNT', 'TRANSFER', 
        'JOB_ISSUE', 'RETURN', 'DAMAGE', 'EXPIRED', 'OTHER'
    )),
    
    active BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE (tenant_id, code)
);

CREATE INDEX idx_reason_codes_tenant_active ON inventory.inventory_reason_codes(tenant_id, active);

-- Seed common reason codes function
CREATE OR REPLACE FUNCTION inventory.seed_default_reason_codes(p_tenant_id UUID)
RETURNS void AS $$
BEGIN
    INSERT INTO inventory.inventory_reason_codes (tenant_id, code, description, category, sort_order)
    VALUES 
        (p_tenant_id, 'LOSS_UNKNOWN', 'Unknown loss', 'LOSS', 10),
        (p_tenant_id, 'LOSS_THEFT', 'Theft or pilferage', 'LOSS', 20),
        (p_tenant_id, 'SCRAP_DAMAGED', 'Damaged beyond repair', 'SCRAP', 30),
        (p_tenant_id, 'SCRAP_OBSOLETE', 'Obsolete/discontinued', 'SCRAP', 40),
        (p_tenant_id, 'ADJUST_COUNT', 'Physical count adjustment', 'ADJUST_COUNT', 50),
        (p_tenant_id, 'ADJUST_FOUND', 'Found inventory', 'ADJUST_COUNT', 60),
        (p_tenant_id, 'JOB_INSTALL', 'Installed on job', 'JOB_ISSUE', 70),
        (p_tenant_id, 'JOB_FABRICATION', 'Used in fabrication', 'JOB_ISSUE', 80),
        (p_tenant_id, 'RETURN_UNUSED', 'Returned unused', 'RETURN', 90),
        (p_tenant_id, 'RETURN_EXCESS', 'Excess from job', 'RETURN', 100)
    ON CONFLICT (tenant_id, code) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4C: AI Suggestions (never auto-applied)
CREATE TABLE inventory.inventory_ai_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    
    -- Suggestion metadata
    suggestion_type TEXT NOT NULL CHECK (suggestion_type IN (
        'reorder_item',
        'transfer_stock',
        'consolidate_locations',
        'flag_obsolete',
        'match_alias',
        'optimize_min_max',
        'identify_duplicate'
    )),
    
    -- Payload (flexible JSONB)
    payload JSONB NOT NULL,
    
    -- AI reasoning (explainability)
    reasoning TEXT,
    confidence NUMERIC(3,2) CHECK (confidence >= 0 AND confidence <= 1),
    
    -- Status
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'accepted', 'rejected', 'expired')),
    
    -- Resolution
    resolved_by UUID REFERENCES auth.users(id),
    resolved_at TIMESTAMPTZ,
    resolution_note TEXT,
    
    -- Audit
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    
    -- Idempotency
    last_event_id UUID UNIQUE
);

CREATE INDEX idx_ai_suggestions_tenant_status ON inventory.inventory_ai_suggestions(tenant_id, status);
CREATE INDEX idx_ai_suggestions_type ON inventory.inventory_ai_suggestions(tenant_id, suggestion_type);
CREATE INDEX idx_ai_suggestions_created ON inventory.inventory_ai_suggestions(tenant_id, created_at DESC);

COMMENT ON TABLE inventory.inventory_ai_suggestions IS 
    'AI-generated suggestions for inventory optimization. Requires human approval.';

-- 4D: Decision Traces (explainability log)
CREATE TABLE inventory.inventory_decision_traces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    
    -- What decision was made
    decision_type TEXT NOT NULL, -- 'reorder_triggered', 'reservation_created', 'stock_adjusted'
    entity_type TEXT, -- 'item', 'location', 'movement'
    entity_id UUID,
    
    -- Why it was made
    reasoning JSONB NOT NULL, -- { "rule": "min_qty_reached", "current": 5, "min": 10, "vendor": "..." }
    
    -- Who/what made it
    decision_maker TEXT NOT NULL, -- 'user', 'ai_agent', 'system_rule', 'automation'
    decided_by UUID REFERENCES auth.users(id),
    
    -- Outcome tracking
    outcome TEXT, -- 'success', 'failed', 'pending'
    outcome_data JSONB,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_decision_traces_tenant_created ON inventory.inventory_decision_traces(tenant_id, created_at DESC);
CREATE INDEX idx_decision_traces_entity ON inventory.inventory_decision_traces(tenant_id, entity_type, entity_id);
CREATE INDEX idx_decision_traces_decision_type ON inventory.inventory_decision_traces(tenant_id, decision_type);

COMMENT ON TABLE inventory.inventory_decision_traces IS 
    'Explainability log for automated and AI-assisted decisions.';

-- ============================================================================
-- SECTION 5: REORDER RULES & ALERTS
-- ============================================================================

CREATE TABLE inventory.inventory_reorder_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    item_id UUID NOT NULL REFERENCES inventory.items(id) ON DELETE CASCADE,
    
    -- Min/max thresholds
    min_quantity NUMERIC(15,4) NOT NULL CHECK (min_quantity >= 0),
    reorder_quantity NUMERIC(15,4) NOT NULL CHECK (reorder_quantity > 0),
    max_quantity NUMERIC(15,4) CHECK (max_quantity IS NULL OR max_quantity >= reorder_quantity),
    
    -- Lead time
    lead_time_days INTEGER DEFAULT 0,
    
    -- Preferred vendor/location
    vendor_id UUID,
    preferred_location_id UUID REFERENCES inventory.locations(id),
    
    -- Active status
    active BOOLEAN NOT NULL DEFAULT true,
    
    -- Audit
    created_by UUID NOT NULL REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE (tenant_id, item_id)
);

CREATE INDEX idx_reorder_rules_tenant_active ON inventory.inventory_reorder_rules(tenant_id, active);
CREATE INDEX idx_reorder_rules_item ON inventory.inventory_reorder_rules(tenant_id, item_id);

-- ============================================================================
-- SECTION 6: READ MODELS (VIEWS FOR FRONTEND)
-- ============================================================================

-- 6A: Comprehensive Item View
CREATE OR REPLACE VIEW inventory.v_inventory_items AS
SELECT 
    i.id,
    i.tenant_id,
    i.name,
    i.sku,
    i.description,
    i.category_id,
    c.name AS category_name,
    i.unit_id,
    u.name AS unit_name,
    u.abbreviation AS unit_abbr,
    i.item_type,
    i.status,
    
    -- Stock summary (aggregated across all locations)
    COALESCE(SUM(s.on_hand_quantity), 0) AS total_on_hand,
    COALESCE(SUM(s.reserved_quantity), 0) AS total_reserved,
    COALESCE(SUM(s.available_quantity), 0) AS total_available,
    
    -- Reorder info
    r.min_quantity,
    r.reorder_quantity,
    r.active AS reorder_active,
    CASE 
        WHEN r.active AND COALESCE(SUM(s.available_quantity), 0) <= r.min_quantity 
        THEN true 
        ELSE false 
    END AS needs_reorder,
    
    -- Metadata
    i.metadata,
    i.created_at,
    i.updated_at
FROM inventory.items i
LEFT JOIN inventory.categories c ON c.id = i.category_id
LEFT JOIN inventory.units u ON u.id = i.unit_id
LEFT JOIN inventory.inventory_stock s ON s.item_id = i.id AND s.tenant_id = i.tenant_id
LEFT JOIN inventory.inventory_reorder_rules r ON r.item_id = i.id AND r.tenant_id = i.tenant_id
GROUP BY 
    i.id, i.tenant_id, i.name, i.sku, i.description, i.category_id, c.name,
    i.unit_id, u.name, u.abbreviation, i.item_type, i.status, i.metadata,
    i.created_at, i.updated_at, r.min_quantity, r.reorder_quantity, r.active;

-- 6B: Availability by Location
CREATE OR REPLACE VIEW inventory.v_inventory_availability_by_location AS
SELECT 
    s.tenant_id,
    s.item_id,
    i.name AS item_name,
    i.sku,
    s.location_id,
    l.name AS location_name,
    s.on_hand_quantity,
    s.reserved_quantity,
    s.available_quantity,
    s.last_movement_at,
    s.updated_at
FROM inventory.inventory_stock s
INNER JOIN inventory.items i ON i.id = s.item_id
LEFT JOIN inventory.locations l ON l.id = s.location_id
WHERE s.on_hand_quantity > 0 OR s.reserved_quantity > 0;

-- 6C: Movement History
CREATE OR REPLACE VIEW inventory.v_inventory_item_movement_history AS
SELECT 
    m.id,
    m.tenant_id,
    m.item_id,
    i.name AS item_name,
    i.sku,
    m.movement_type,
    m.quantity_delta,
    m.unit_id,
    u.abbreviation AS unit_abbr,
    m.from_location_id,
    loc_from.name AS from_location_name,
    m.to_location_id,
    loc_to.name AS to_location_name,
    m.job_id,
    m.employee_id,
    m.reason_code,
    m.reason_text,
    m.created_by,
    users.email AS created_by_email,
    m.created_at
FROM inventory.inventory_movements m
INNER JOIN inventory.items i ON i.id = m.item_id
LEFT JOIN inventory.units u ON u.id = m.unit_id
LEFT JOIN inventory.locations loc_from ON loc_from.id = m.from_location_id
LEFT JOIN inventory.locations loc_to ON loc_to.id = m.to_location_id
LEFT JOIN auth.users users ON users.id = m.created_by
ORDER BY m.created_at DESC;

-- 6D: Low Stock Alerts
CREATE OR REPLACE VIEW inventory.v_inventory_low_stock_alerts AS
SELECT 
    i.id AS item_id,
    i.tenant_id,
    i.name AS item_name,
    i.sku,
    COALESCE(SUM(s.available_quantity), 0) AS current_available,
    r.min_quantity,
    r.reorder_quantity,
    r.lead_time_days,
    r.vendor_id,
    r.preferred_location_id,
    (r.min_quantity - COALESCE(SUM(s.available_quantity), 0)) AS shortage_quantity
FROM inventory.items i
INNER JOIN inventory.inventory_reorder_rules r ON r.item_id = i.id AND r.tenant_id = i.tenant_id
LEFT JOIN inventory.inventory_stock s ON s.item_id = i.id AND s.tenant_id = i.tenant_id
WHERE r.active = true
  AND i.status = 'active'
GROUP BY i.id, i.tenant_id, i.name, i.sku, r.min_quantity, r.reorder_quantity, r.lead_time_days, r.vendor_id, r.preferred_location_id
HAVING COALESCE(SUM(s.available_quantity), 0) <= r.min_quantity;

-- 6E: Active Reservations
CREATE OR REPLACE VIEW inventory.v_inventory_active_reservations AS
SELECT 
    res.id,
    res.tenant_id,
    res.item_id,
    i.name AS item_name,
    i.sku,
    res.quantity,
    u.abbreviation AS unit_abbr,
    res.location_id,
    l.name AS location_name,
    res.reference_type,
    res.reference_id,
    res.job_id,
    res.reserved_until,
    res.created_by,
    users.email AS created_by_email,
    res.created_at
FROM inventory.inventory_reservations res
INNER JOIN inventory.items i ON i.id = res.item_id
LEFT JOIN inventory.units u ON u.id = res.unit_id
LEFT JOIN inventory.locations l ON l.id = res.location_id
LEFT JOIN auth.users users ON users.id = res.created_by
WHERE res.status = 'active';

-- ============================================================================
-- SECTION 7: SAFE OPERATION RPCs
-- ============================================================================

-- 7A: Receive Purchase Order
CREATE OR REPLACE FUNCTION inventory.rpc_inventory_receive_po(
    p_tenant_id UUID,
    p_user_id UUID,
    p_po_id UUID,
    p_po_line_id UUID,
    p_item_id UUID,
    p_quantity NUMERIC,
    p_unit_id UUID,
    p_to_location_id UUID,
    p_vendor_id UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_event_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_movement_id UUID;
    v_item_name TEXT;
BEGIN
    -- Validate tenant scope
    IF NOT EXISTS (SELECT 1 FROM inventory.items WHERE id = p_item_id AND tenant_id = p_tenant_id) THEN
        RAISE EXCEPTION 'Item % not found for tenant %', p_item_id, p_tenant_id;
    END IF;
    
    -- Get item name for response
    SELECT name INTO v_item_name FROM inventory.items WHERE id = p_item_id;
    
    -- Insert movement (idempotent)
    INSERT INTO inventory.inventory_movements (
        tenant_id, movement_type, quantity_delta, unit_id, item_id,
        to_location_id, po_id, po_line_id, vendor_id,
        reason_text, created_by, last_event_id
    )
    VALUES (
        p_tenant_id, 'purchase_receive', p_quantity, p_unit_id, p_item_id,
        p_to_location_id, p_po_id, p_po_line_id, p_vendor_id,
        p_notes, p_user_id, p_event_id
    )
    ON CONFLICT (last_event_id) DO NOTHING
    RETURNING id INTO v_movement_id;
    
    -- Return result
    RETURN jsonb_build_object(
        'success', v_movement_id IS NOT NULL,
        'movement_id', v_movement_id,
        'item_name', v_item_name,
        'quantity', p_quantity,
        'location_id', p_to_location_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7B: Issue to Job
CREATE OR REPLACE FUNCTION inventory.rpc_inventory_issue_to_job(
    p_tenant_id UUID,
    p_user_id UUID,
    p_item_id UUID,
    p_quantity NUMERIC,
    p_unit_id UUID,
    p_from_location_id UUID,
    p_job_id UUID,
    p_reason_code TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_event_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_movement_id UUID;
    v_available NUMERIC;
BEGIN
    -- Check availability
    SELECT COALESCE(available_quantity, 0) INTO v_available
    FROM inventory.inventory_stock
    WHERE tenant_id = p_tenant_id 
      AND item_id = p_item_id 
      AND location_id = p_from_location_id;
    
    IF v_available < p_quantity THEN
        RAISE EXCEPTION 'Insufficient stock. Available: %, Requested: %', v_available, p_quantity;
    END IF;
    
    -- Create movement
    INSERT INTO inventory.inventory_movements (
        tenant_id, movement_type, quantity_delta, unit_id, item_id,
        from_location_id, job_id, reason_code, reason_text,
        created_by, last_event_id
    )
    VALUES (
        p_tenant_id, 'issue_to_job', -p_quantity, p_unit_id, p_item_id,
        p_from_location_id, p_job_id, p_reason_code, p_notes,
        p_user_id, p_event_id
    )
    ON CONFLICT (last_event_id) DO NOTHING
    RETURNING id INTO v_movement_id;
    
    RETURN jsonb_build_object(
        'success', v_movement_id IS NOT NULL,
        'movement_id', v_movement_id,
        'remaining_available', v_available - p_quantity
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7C: Return from Job
CREATE OR REPLACE FUNCTION inventory.rpc_inventory_return_from_job(
    p_tenant_id UUID,
    p_user_id UUID,
    p_item_id UUID,
    p_quantity NUMERIC,
    p_unit_id UUID,
    p_to_location_id UUID,
    p_job_id UUID,
    p_reason_code TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_event_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_movement_id UUID;
BEGIN
    INSERT INTO inventory.inventory_movements (
        tenant_id, movement_type, quantity_delta, unit_id, item_id,
        to_location_id, job_id, reason_code, reason_text,
        created_by, last_event_id
    )
    VALUES (
        p_tenant_id, 'return_from_job', p_quantity, p_unit_id, p_item_id,
        p_to_location_id, p_job_id, p_reason_code, p_notes,
        p_user_id, p_event_id
    )
    ON CONFLICT (last_event_id) DO NOTHING
    RETURNING id INTO v_movement_id;
    
    RETURN jsonb_build_object(
        'success', v_movement_id IS NOT NULL,
        'movement_id', v_movement_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7D: Transfer Between Locations
CREATE OR REPLACE FUNCTION inventory.rpc_inventory_transfer(
    p_tenant_id UUID,
    p_user_id UUID,
    p_item_id UUID,
    p_quantity NUMERIC,
    p_unit_id UUID,
    p_from_location_id UUID,
    p_to_location_id UUID,
    p_notes TEXT DEFAULT NULL,
    p_event_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_movement_id UUID;
    v_available NUMERIC;
BEGIN
    -- Check availability at source
    SELECT COALESCE(available_quantity, 0) INTO v_available
    FROM inventory.inventory_stock
    WHERE tenant_id = p_tenant_id 
      AND item_id = p_item_id 
      AND location_id = p_from_location_id;
    
    IF v_available < p_quantity THEN
        RAISE EXCEPTION 'Insufficient stock at source location. Available: %, Requested: %', v_available, p_quantity;
    END IF;
    
    -- Create movement
    INSERT INTO inventory.inventory_movements (
        tenant_id, movement_type, quantity_delta, unit_id, item_id,
        from_location_id, to_location_id, reason_text,
        created_by, last_event_id
    )
    VALUES (
        p_tenant_id, 'transfer', p_quantity, p_unit_id, p_item_id,
        p_from_location_id, p_to_location_id, p_notes,
        p_user_id, p_event_id
    )
    ON CONFLICT (last_event_id) DO NOTHING
    RETURNING id INTO v_movement_id;
    
    RETURN jsonb_build_object(
        'success', v_movement_id IS NOT NULL,
        'movement_id', v_movement_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7E: Adjust Stock (Count/Loss/Found)
CREATE OR REPLACE FUNCTION inventory.rpc_inventory_adjust(
    p_tenant_id UUID,
    p_user_id UUID,
    p_item_id UUID,
    p_quantity_delta NUMERIC,
    p_unit_id UUID,
    p_location_id UUID,
    p_reason_code TEXT,
    p_notes TEXT DEFAULT NULL,
    p_event_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_movement_id UUID;
    v_movement_type TEXT;
BEGIN
    -- Determine movement type based on delta
    IF p_quantity_delta > 0 THEN
        v_movement_type := 'found';
    ELSIF p_quantity_delta < 0 THEN
        v_movement_type := 'adjust';
    ELSE
        RAISE EXCEPTION 'Adjustment quantity cannot be zero';
    END IF;
    
    -- Create movement (to_location for positive, from_location for negative)
    INSERT INTO inventory.inventory_movements (
        tenant_id, movement_type, quantity_delta, unit_id, item_id,
        from_location_id, to_location_id, reason_code, reason_text,
        created_by, last_event_id
    )
    VALUES (
        p_tenant_id, v_movement_type, p_quantity_delta, p_unit_id, p_item_id,
        CASE WHEN p_quantity_delta < 0 THEN p_location_id ELSE NULL END,
        CASE WHEN p_quantity_delta > 0 THEN p_location_id ELSE NULL END,
        p_reason_code, p_notes,
        p_user_id, p_event_id
    )
    ON CONFLICT (last_event_id) DO NOTHING
    RETURNING id INTO v_movement_id;
    
    RETURN jsonb_build_object(
        'success', v_movement_id IS NOT NULL,
        'movement_id', v_movement_id,
        'adjustment', p_quantity_delta
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7F: Create Reservation
CREATE OR REPLACE FUNCTION inventory.rpc_inventory_reserve(
    p_tenant_id UUID,
    p_user_id UUID,
    p_item_id UUID,
    p_quantity NUMERIC,
    p_unit_id UUID,
    p_location_id UUID DEFAULT NULL,
    p_reference_type TEXT DEFAULT NULL,
    p_reference_id UUID DEFAULT NULL,
    p_job_id UUID DEFAULT NULL,
    p_reserved_until TIMESTAMPTZ DEFAULT NULL,
    p_event_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_reservation_id UUID;
    v_available NUMERIC;
BEGIN
    -- Check availability
    SELECT COALESCE(SUM(available_quantity), 0) INTO v_available
    FROM inventory.inventory_stock
    WHERE tenant_id = p_tenant_id 
      AND item_id = p_item_id
      AND (p_location_id IS NULL OR location_id = p_location_id);
    
    IF v_available < p_quantity THEN
        RAISE EXCEPTION 'Insufficient available stock. Available: %, Requested: %', v_available, p_quantity;
    END IF;
    
    -- Create reservation
    INSERT INTO inventory.inventory_reservations (
        tenant_id, item_id, quantity, unit_id, location_id,
        reference_type, reference_id, job_id, reserved_until,
        created_by, last_event_id
    )
    VALUES (
        p_tenant_id, p_item_id, p_quantity, p_unit_id, p_location_id,
        p_reference_type, p_reference_id, p_job_id, p_reserved_until,
        p_user_id, p_event_id
    )
    ON CONFLICT (last_event_id) DO NOTHING
    RETURNING id INTO v_reservation_id;
    
    RETURN jsonb_build_object(
        'success', v_reservation_id IS NOT NULL,
        'reservation_id', v_reservation_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7G: Release Reservation
CREATE OR REPLACE FUNCTION inventory.rpc_inventory_release_reservation(
    p_tenant_id UUID,
    p_user_id UUID,
    p_reservation_id UUID,
    p_event_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_updated BOOLEAN;
BEGIN
    UPDATE inventory.inventory_reservations
    SET status = 'canceled',
        updated_at = NOW()
    WHERE id = p_reservation_id
      AND tenant_id = p_tenant_id
      AND status = 'active'
    RETURNING true INTO v_updated;
    
    RETURN jsonb_build_object(
        'success', COALESCE(v_updated, false),
        'reservation_id', p_reservation_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- SECTION 8: TENANT ONBOARDING
-- ============================================================================

-- Bootstrap function for new tenants
CREATE OR REPLACE FUNCTION inventory.rpc_inventory_bootstrap_tenant(
    p_tenant_id UUID,
    p_user_id UUID
)
RETURNS JSONB AS $$
DECLARE
    v_default_location_id UUID;
    v_default_unit_id UUID;
    v_result JSONB;
BEGIN
    -- Create default location if none exists
    INSERT INTO inventory.locations (tenant_id, name, location_type, is_default, created_by)
    VALUES (p_tenant_id, 'Default Yard', 'yard', true, p_user_id)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_default_location_id;
    
    -- If location already existed, get its ID
    IF v_default_location_id IS NULL THEN
        SELECT id INTO v_default_location_id
        FROM inventory.locations
        WHERE tenant_id = p_tenant_id AND is_default = true
        LIMIT 1;
    END IF;
    
    -- Create default unit (EA - Each) if none exists
    INSERT INTO inventory.units (tenant_id, name, abbreviation, created_by)
    VALUES (p_tenant_id, 'Each', 'EA', p_user_id)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_default_unit_id;
    
    IF v_default_unit_id IS NULL THEN
        SELECT id INTO v_default_unit_id
        FROM inventory.units
        WHERE tenant_id = p_tenant_id AND abbreviation = 'EA'
        LIMIT 1;
    END IF;
    
    -- Seed reason codes
    PERFORM inventory.seed_default_reason_codes(p_tenant_id);
    
    v_result := jsonb_build_object(
        'success', true,
        'default_location_id', v_default_location_id,
        'default_unit_id', v_default_unit_id,
        'reason_codes_seeded', true
    );
    
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- SECTION 9: ROW-LEVEL SECURITY (RLS)
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE inventory.inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.inventory_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.inventory_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.inventory_item_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.inventory_reason_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.inventory_ai_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.inventory_decision_traces ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory.inventory_reorder_rules ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Movements
CREATE POLICY movements_tenant_isolation ON inventory.inventory_movements
    FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY movements_service_role ON inventory.inventory_movements
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- RLS Policies: Stock
CREATE POLICY stock_tenant_isolation ON inventory.inventory_stock
    FOR SELECT USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY stock_service_role ON inventory.inventory_stock
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- RLS Policies: Reservations
CREATE POLICY reservations_tenant_isolation ON inventory.inventory_reservations
    FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY reservations_service_role ON inventory.inventory_reservations
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- RLS Policies: Item Aliases
CREATE POLICY aliases_tenant_isolation ON inventory.inventory_item_aliases
    FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY aliases_service_role ON inventory.inventory_item_aliases
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- RLS Policies: Reason Codes
CREATE POLICY reason_codes_tenant_isolation ON inventory.inventory_reason_codes
    FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY reason_codes_service_role ON inventory.inventory_reason_codes
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- RLS Policies: AI Suggestions
CREATE POLICY ai_suggestions_tenant_isolation ON inventory.inventory_ai_suggestions
    FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY ai_suggestions_service_role ON inventory.inventory_ai_suggestions
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- RLS Policies: Decision Traces
CREATE POLICY decision_traces_tenant_isolation ON inventory.inventory_decision_traces
    FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY decision_traces_service_role ON inventory.inventory_decision_traces
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- RLS Policies: Reorder Rules
CREATE POLICY reorder_rules_tenant_isolation ON inventory.inventory_reorder_rules
    FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY reorder_rules_service_role ON inventory.inventory_reorder_rules
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- SECTION 10: EVENTS OUTBOX INTEGRATION
-- ============================================================================

-- Create outbox table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.events_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    event_type TEXT NOT NULL,
    aggregate_type TEXT NOT NULL,
    aggregate_id UUID NOT NULL,
    payload JSONB NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_outbox_status ON public.events_outbox(status, created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_outbox_tenant ON public.events_outbox(tenant_id);

-- Enable RLS on outbox
ALTER TABLE public.events_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY outbox_tenant_isolation ON public.events_outbox
    FOR ALL USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

CREATE POLICY outbox_service_role ON public.events_outbox
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Function to publish movement events to outbox
CREATE OR REPLACE FUNCTION inventory.publish_movement_event()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.events_outbox (tenant_id, event_type, aggregate_type, aggregate_id, payload)
    VALUES (
        NEW.tenant_id,
        'inventory.movement.created',
        'inventory_movement',
        NEW.id,
        jsonb_build_object(
            'movement_id', NEW.id,
            'movement_type', NEW.movement_type,
            'item_id', NEW.item_id,
            'quantity_delta', NEW.quantity_delta,
            'from_location_id', NEW.from_location_id,
            'to_location_id', NEW.to_location_id,
            'job_id', NEW.job_id,
            'created_by', NEW.created_by,
            'created_at', NEW.created_at
        )
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_publish_movement_event
    AFTER INSERT ON inventory.inventory_movements
    FOR EACH ROW EXECUTE FUNCTION inventory.publish_movement_event();

-- Function to publish reservation events
CREATE OR REPLACE FUNCTION inventory.publish_reservation_event()
RETURNS TRIGGER AS $$
DECLARE
    v_event_type TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_event_type := 'inventory.reservation.created';
    ELSIF NEW.status != OLD.status THEN
        v_event_type := 'inventory.reservation.status_changed';
    ELSE
        RETURN NEW;
    END IF;
    
    INSERT INTO public.events_outbox (tenant_id, event_type, aggregate_type, aggregate_id, payload)
    VALUES (
        NEW.tenant_id,
        v_event_type,
        'inventory_reservation',
        NEW.id,
        jsonb_build_object(
            'reservation_id', NEW.id,
            'item_id', NEW.item_id,
            'quantity', NEW.quantity,
            'status', NEW.status,
            'job_id', NEW.job_id,
            'created_by', NEW.created_by,
            'created_at', NEW.created_at
        )
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_publish_reservation_event
    AFTER INSERT OR UPDATE ON inventory.inventory_reservations
    FOR EACH ROW EXECUTE FUNCTION inventory.publish_reservation_event();

-- ============================================================================
-- SECTION 11: HELPER FUNCTIONS
-- ============================================================================

-- Function to rebuild stock from movements (disaster recovery)
CREATE OR REPLACE FUNCTION inventory.rebuild_stock_from_ledger(p_tenant_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_rows_updated INTEGER := 0;
BEGIN
    -- Clear existing stock for tenant
    DELETE FROM inventory.inventory_stock WHERE tenant_id = p_tenant_id;
    
    -- Rebuild from movements
    INSERT INTO inventory.inventory_stock (tenant_id, item_id, location_id, on_hand_quantity, last_movement_at)
    SELECT 
        m.tenant_id,
        m.item_id,
        COALESCE(m.to_location_id, m.from_location_id) AS location_id,
        SUM(
            CASE 
                WHEN m.to_location_id IS NOT NULL AND m.from_location_id IS NULL THEN m.quantity_delta
                WHEN m.to_location_id IS NOT NULL AND m.from_location_id IS NOT NULL THEN m.quantity_delta
                WHEN m.from_location_id IS NOT NULL AND m.to_location_id IS NULL THEN -m.quantity_delta
                ELSE 0
            END
        ) AS on_hand_quantity,
        MAX(m.created_at) AS last_movement_at
    FROM inventory.inventory_movements m
    WHERE m.tenant_id = p_tenant_id
    GROUP BY m.tenant_id, m.item_id, COALESCE(m.to_location_id, m.from_location_id)
    HAVING SUM(
        CASE 
            WHEN m.to_location_id IS NOT NULL AND m.from_location_id IS NULL THEN m.quantity_delta
            WHEN m.to_location_id IS NOT NULL AND m.from_location_id IS NOT NULL THEN m.quantity_delta
            WHEN m.from_location_id IS NOT NULL AND m.to_location_id IS NULL THEN -m.quantity_delta
            ELSE 0
        END
    ) != 0;
    
    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
    
    RETURN jsonb_build_object(
        'success', true,
        'tenant_id', p_tenant_id,
        'stock_records_created', v_rows_updated
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- SECTION 12: GRANTS
-- ============================================================================

-- Grant usage on schema
GRANT USAGE ON SCHEMA inventory TO authenticated, anon;
GRANT ALL ON SCHEMA inventory TO service_role;

-- Grant permissions on tables
GRANT SELECT, INSERT ON inventory.inventory_movements TO authenticated;
GRANT ALL ON inventory.inventory_movements TO service_role;

GRANT SELECT ON inventory.inventory_stock TO authenticated;
GRANT ALL ON inventory.inventory_stock TO service_role;

GRANT SELECT, INSERT, UPDATE ON inventory.inventory_reservations TO authenticated;
GRANT ALL ON inventory.inventory_reservations TO service_role;

GRANT SELECT, INSERT ON inventory.inventory_item_aliases TO authenticated;
GRANT ALL ON inventory.inventory_item_aliases TO service_role;

GRANT SELECT ON inventory.inventory_reason_codes TO authenticated;
GRANT ALL ON inventory.inventory_reason_codes TO service_role;

GRANT SELECT, INSERT, UPDATE ON inventory.inventory_ai_suggestions TO authenticated;
GRANT ALL ON inventory.inventory_ai_suggestions TO service_role;

GRANT SELECT ON inventory.inventory_decision_traces TO authenticated;
GRANT ALL ON inventory.inventory_decision_traces TO service_role;

GRANT SELECT, INSERT, UPDATE ON inventory.inventory_reorder_rules TO authenticated;
GRANT ALL ON inventory.inventory_reorder_rules TO service_role;

-- Grant execute on functions
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA inventory TO authenticated, service_role;

COMMIT;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

-- Run the following SQL to verify the migration:
/*
-- 1. Check tables exist
SELECT schemaname, tablename 
FROM pg_tables 
WHERE schemaname = 'inventory' 
ORDER BY tablename;

-- 2. Check RLS is enabled
SELECT schemaname, tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'inventory';

-- 3. Check policies exist
SELECT schemaname, tablename, policyname 
FROM pg_policies 
WHERE schemaname = 'inventory' 
ORDER BY tablename, policyname;

-- 4. Check views exist
SELECT schemaname, viewname 
FROM pg_views 
WHERE schemaname = 'inventory' 
ORDER BY viewname;

-- 5. Check functions exist
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_schema = 'inventory' 
ORDER BY routine_name;

-- 6. Test bootstrap function (replace with your tenant_id and user_id)
SELECT inventory.rpc_inventory_bootstrap_tenant(
    'your-tenant-uuid'::uuid,
    'your-user-uuid'::uuid
);
*/
