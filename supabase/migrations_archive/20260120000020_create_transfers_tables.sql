-- ============================================================================
-- PHASE 3: TRANSFERS - Inter-Location Movement
-- ============================================================================
-- Enables moving inventory between locations with full audit trail

-- =====================================================
-- TRANSFERS HEADER
-- =====================================================
CREATE TABLE inventory.transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    transfer_number TEXT NOT NULL,
    from_location_id UUID NOT NULL REFERENCES inventory.locations(id) ON DELETE RESTRICT,
    to_location_id UUID NOT NULL REFERENCES inventory.locations(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_transit', 'completed', 'cancelled')),
    initiated_by_user_id UUID NULL,
    received_by_user_id UUID NULL,
    initiated_at TIMESTAMPTZ NULL,
    completed_at TIMESTAMPTZ NULL,
    cancelled_at TIMESTAMPTZ NULL,
    cancellation_reason TEXT NULL,
    notes TEXT NULL,
    last_event_id TEXT NOT NULL, -- ✅ Idempotency key
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT transfers_tenant_transfer_number_unique 
        UNIQUE (tenant_id, transfer_number),
    CONSTRAINT transfers_tenant_last_event_id_unique 
        UNIQUE (tenant_id, last_event_id),
    CONSTRAINT transfers_different_locations 
        CHECK (from_location_id != to_location_id)
);

-- Indexes
CREATE INDEX idx_transfers_tenant_id ON inventory.transfers(tenant_id);
CREATE INDEX idx_transfers_from_location_id ON inventory.transfers(from_location_id);
CREATE INDEX idx_transfers_to_location_id ON inventory.transfers(to_location_id);
CREATE INDEX idx_transfers_status ON inventory.transfers(tenant_id, status);
CREATE INDEX idx_transfers_initiated_at ON inventory.transfers(tenant_id, initiated_at DESC);
CREATE INDEX idx_transfers_created_at ON inventory.transfers(created_at DESC);

COMMENT ON TABLE inventory.transfers IS 
    'Transfer header - tracks inventory movements between locations';
COMMENT ON COLUMN inventory.transfers.last_event_id IS 
    'Idempotency key for transfer creation/execution';

-- Enable RLS
ALTER TABLE inventory.transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY transfers_tenant_isolation ON inventory.transfers
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

CREATE POLICY transfers_service_role ON inventory.transfers
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- Trigger for updated_at
CREATE TRIGGER update_transfers_updated_at
    BEFORE UPDATE ON inventory.transfers
    FOR EACH ROW
    EXECUTE FUNCTION inventory.update_updated_at_column();

-- =====================================================
-- TRANSFER LINES
-- =====================================================
CREATE TABLE inventory.transfer_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    transfer_id UUID NOT NULL REFERENCES inventory.transfers(id) ON DELETE CASCADE,
    line_number INTEGER NOT NULL,
    catalog_item_id UUID NOT NULL REFERENCES inventory.catalog_items(id) ON DELETE RESTRICT,
    qty NUMERIC(18, 4) NOT NULL,
    last_event_id TEXT NOT NULL, -- ✅ Idempotency key for line-level operations
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT transfer_lines_transfer_line_unique 
        UNIQUE (transfer_id, line_number),
    CONSTRAINT transfer_lines_tenant_last_event_id_unique 
        UNIQUE (tenant_id, last_event_id),
    CONSTRAINT transfer_lines_qty_check 
        CHECK (qty > 0)
);

-- Indexes
CREATE INDEX idx_transfer_lines_tenant_id ON inventory.transfer_lines(tenant_id);
CREATE INDEX idx_transfer_lines_transfer_id ON inventory.transfer_lines(transfer_id);
CREATE INDEX idx_transfer_lines_catalog_item_id ON inventory.transfer_lines(catalog_item_id);

COMMENT ON TABLE inventory.transfer_lines IS 
    'Transfer line items - what items and quantities are being transferred';

-- Enable RLS
ALTER TABLE inventory.transfer_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY transfer_lines_tenant_isolation ON inventory.transfer_lines
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

CREATE POLICY transfer_lines_service_role ON inventory.transfer_lines
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- Trigger for updated_at
CREATE TRIGGER update_transfer_lines_updated_at
    BEFORE UPDATE ON inventory.transfer_lines
    FOR EACH ROW
    EXECUTE FUNCTION inventory.update_updated_at_column();

DO $$ BEGIN
    RAISE NOTICE '✅ Transfers tables created';
END $$;

