-- Migration: Create event ledger tables (source of truth)
-- This is the heart of "event-driven inventory" - all changes flow through these tables

-- =====================================================
-- INVENTORY EVENTS TABLE
-- =====================================================
-- Represents: receive/issue/transfer/adjust/reserve/unreserve/return
CREATE TABLE inventory.inventory_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('receive', 'issue', 'transfer', 'adjust', 'reserve', 'unreserve', 'return', 'allocate', 'consume')),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor_user_id UUID NULL, -- Who initiated this event
    source_system TEXT NULL, -- e.g., 'web_app', 'mobile_app', 'webhook', 'import'
    last_event_id TEXT NOT NULL, -- ✅ Idempotency key
    payload JSONB NOT NULL, -- item_id, qty, from/to location, reason, job refs, etc.
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Unique constraint for idempotency
    CONSTRAINT inventory_events_tenant_last_event_id_unique UNIQUE (tenant_id, last_event_id)
);

-- Indexes for inventory_events
CREATE INDEX idx_inventory_events_tenant_id ON inventory.inventory_events(tenant_id);
CREATE INDEX idx_inventory_events_occurred_at ON inventory.inventory_events(tenant_id, occurred_at DESC);
CREATE INDEX idx_inventory_events_event_type ON inventory.inventory_events(tenant_id, event_type);
CREATE INDEX idx_inventory_events_actor_user_id ON inventory.inventory_events(actor_user_id) WHERE actor_user_id IS NOT NULL;
CREATE INDEX idx_inventory_events_payload ON inventory.inventory_events USING GIN (payload);
CREATE INDEX idx_inventory_events_created_at ON inventory.inventory_events(created_at DESC);

-- Index for processing events (to find unprocessed ones)
CREATE INDEX idx_inventory_events_processing ON inventory.inventory_events(tenant_id, created_at) 
    WHERE (payload->>'processed')::BOOLEAN IS NOT TRUE;

-- =====================================================
-- ASSET EVENTS TABLE
-- =====================================================
-- Represents: asset assigned, moved, status changed, maintenance logged, retired
CREATE TABLE inventory.asset_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('assigned', 'unassigned', 'moved', 'status_changed', 'maintenance_logged', 'retired', 'activated', 'inspected')),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    asset_id UUID NOT NULL, -- Reference to the asset
    actor_user_id UUID NULL,
    source_system TEXT NULL,
    last_event_id TEXT NOT NULL, -- ✅ Idempotency key
    payload JSONB NOT NULL, -- new location, new status, assignment details, maintenance notes, etc.
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Unique constraint for idempotency
    CONSTRAINT asset_events_tenant_last_event_id_unique UNIQUE (tenant_id, last_event_id)
);

-- Indexes for asset_events
CREATE INDEX idx_asset_events_tenant_id ON inventory.asset_events(tenant_id);
CREATE INDEX idx_asset_events_asset_id ON inventory.asset_events(tenant_id, asset_id);
CREATE INDEX idx_asset_events_occurred_at ON inventory.asset_events(tenant_id, occurred_at DESC);
CREATE INDEX idx_asset_events_event_type ON inventory.asset_events(tenant_id, event_type);
CREATE INDEX idx_asset_events_actor_user_id ON inventory.asset_events(actor_user_id) WHERE actor_user_id IS NOT NULL;
CREATE INDEX idx_asset_events_payload ON inventory.asset_events USING GIN (payload);
CREATE INDEX idx_asset_events_created_at ON inventory.asset_events(created_at DESC);

-- Index for processing events
CREATE INDEX idx_asset_events_processing ON inventory.asset_events(tenant_id, created_at) 
    WHERE (payload->>'processed')::BOOLEAN IS NOT TRUE;

-- =====================================================
-- PROCUREMENT EVENTS TABLE (optional for PO integration)
-- =====================================================
-- Represents: PO created, PO approved, items received, invoice matched, etc.
CREATE TABLE inventory.procurement_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('po_created', 'po_approved', 'po_cancelled', 'items_received', 'invoice_matched', 'payment_made')),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    po_id UUID NULL, -- Reference to PO if applicable
    actor_user_id UUID NULL,
    source_system TEXT NULL,
    last_event_id TEXT NOT NULL, -- ✅ Idempotency key
    payload JSONB NOT NULL, -- PO details, received items, invoice info, etc.
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Unique constraint for idempotency
    CONSTRAINT procurement_events_tenant_last_event_id_unique UNIQUE (tenant_id, last_event_id)
);

-- Indexes for procurement_events
CREATE INDEX idx_procurement_events_tenant_id ON inventory.procurement_events(tenant_id);
CREATE INDEX idx_procurement_events_po_id ON inventory.procurement_events(tenant_id, po_id) WHERE po_id IS NOT NULL;
CREATE INDEX idx_procurement_events_occurred_at ON inventory.procurement_events(tenant_id, occurred_at DESC);
CREATE INDEX idx_procurement_events_event_type ON inventory.procurement_events(tenant_id, event_type);
CREATE INDEX idx_procurement_events_actor_user_id ON inventory.procurement_events(actor_user_id) WHERE actor_user_id IS NOT NULL;
CREATE INDEX idx_procurement_events_payload ON inventory.procurement_events USING GIN (payload);
CREATE INDEX idx_procurement_events_created_at ON inventory.procurement_events(created_at DESC);

-- Index for processing events
CREATE INDEX idx_procurement_events_processing ON inventory.procurement_events(tenant_id, created_at) 
    WHERE (payload->>'processed')::BOOLEAN IS NOT TRUE;

-- =====================================================
-- RLS POLICIES - INVENTORY_EVENTS
-- =====================================================
ALTER TABLE inventory.inventory_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY inventory_events_tenant_isolation ON inventory.inventory_events
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

-- =====================================================
-- RLS POLICIES - ASSET_EVENTS
-- =====================================================
ALTER TABLE inventory.asset_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY asset_events_tenant_isolation ON inventory.asset_events
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

-- =====================================================
-- RLS POLICIES - PROCUREMENT_EVENTS
-- =====================================================
ALTER TABLE inventory.procurement_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY procurement_events_tenant_isolation ON inventory.procurement_events
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

-- =====================================================
-- HELPER FUNCTIONS FOR IDEMPOTENT INSERTS
-- =====================================================

-- Helper function to insert inventory event idempotently
CREATE OR REPLACE FUNCTION inventory.insert_inventory_event(
    p_tenant_id UUID,
    p_event_type TEXT,
    p_occurred_at TIMESTAMPTZ,
    p_actor_user_id UUID,
    p_source_system TEXT,
    p_last_event_id TEXT,
    p_payload JSONB
) RETURNS UUID AS $$
DECLARE
    v_event_id UUID;
BEGIN
    INSERT INTO inventory.inventory_events (
        tenant_id,
        event_type,
        occurred_at,
        actor_user_id,
        source_system,
        last_event_id,
        payload
    ) VALUES (
        p_tenant_id,
        p_event_type,
        p_occurred_at,
        p_actor_user_id,
        p_source_system,
        p_last_event_id,
        p_payload
    )
    ON CONFLICT (tenant_id, last_event_id) DO NOTHING
    RETURNING id INTO v_event_id;
    
    -- If conflict occurred, get existing event id
    IF v_event_id IS NULL THEN
        SELECT id INTO v_event_id
        FROM inventory.inventory_events
        WHERE tenant_id = p_tenant_id AND last_event_id = p_last_event_id;
    END IF;
    
    RETURN v_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function to insert asset event idempotently
CREATE OR REPLACE FUNCTION inventory.insert_asset_event(
    p_tenant_id UUID,
    p_event_type TEXT,
    p_occurred_at TIMESTAMPTZ,
    p_asset_id UUID,
    p_actor_user_id UUID,
    p_source_system TEXT,
    p_last_event_id TEXT,
    p_payload JSONB
) RETURNS UUID AS $$
DECLARE
    v_event_id UUID;
BEGIN
    INSERT INTO inventory.asset_events (
        tenant_id,
        event_type,
        occurred_at,
        asset_id,
        actor_user_id,
        source_system,
        last_event_id,
        payload
    ) VALUES (
        p_tenant_id,
        p_event_type,
        p_occurred_at,
        p_asset_id,
        p_actor_user_id,
        p_source_system,
        p_last_event_id,
        p_payload
    )
    ON CONFLICT (tenant_id, last_event_id) DO NOTHING
    RETURNING id INTO v_event_id;
    
    -- If conflict occurred, get existing event id
    IF v_event_id IS NULL THEN
        SELECT id INTO v_event_id
        FROM inventory.asset_events
        WHERE tenant_id = p_tenant_id AND last_event_id = p_last_event_id;
    END IF;
    
    RETURN v_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- COMMENTS
-- =====================================================
COMMENT ON TABLE inventory.inventory_events IS 'Immutable event ledger for all inventory movements (receive, issue, transfer, adjust, etc.)';
COMMENT ON TABLE inventory.asset_events IS 'Immutable event ledger for all asset lifecycle events (assignment, moves, maintenance, etc.)';
COMMENT ON TABLE inventory.procurement_events IS 'Immutable event ledger for purchase order and procurement workflow events';
COMMENT ON COLUMN inventory.inventory_events.last_event_id IS 'Idempotency key - prevents duplicate event processing';
COMMENT ON COLUMN inventory.asset_events.last_event_id IS 'Idempotency key - prevents duplicate event processing';
COMMENT ON COLUMN inventory.procurement_events.last_event_id IS 'Idempotency key - prevents duplicate event processing';
