-- Migration: Events outbox for domain events
-- Aligns with events_outbox pattern for event-driven architecture

CREATE TABLE inventory.events_outbox (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('tenant', 'profile', 'global')),
    event_type TEXT NOT NULL,
    aggregate_type TEXT NOT NULL, -- e.g., 'catalog_item', 'asset', 'stock_balance'
    aggregate_id UUID NOT NULL,
    actor_user_id UUID NULL REFERENCES auth.users(id),
    payload JSONB NOT NULL,
    metadata JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'failed')),
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT NULL
);

-- Indexes for outbox processing
CREATE INDEX idx_events_outbox_tenant_id ON inventory.events_outbox(tenant_id);
CREATE INDEX idx_events_outbox_status ON inventory.events_outbox(status, created_at) WHERE status = 'pending';
CREATE INDEX idx_events_outbox_aggregate ON inventory.events_outbox(aggregate_type, aggregate_id);
CREATE INDEX idx_events_outbox_event_type ON inventory.events_outbox(event_type);
CREATE INDEX idx_events_outbox_created_at ON inventory.events_outbox(created_at DESC);

-- RLS policy
ALTER TABLE inventory.events_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY events_outbox_tenant_isolation ON inventory.events_outbox
    FOR ALL
    USING (
        scope = 'global' 
        OR (scope = 'tenant' AND tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
        OR (scope = 'profile' AND actor_user_id = auth.uid())
    );

-- Function to publish domain events
CREATE OR REPLACE FUNCTION inventory.publish_event(
    p_tenant_id UUID,
    p_scope TEXT,
    p_event_type TEXT,
    p_aggregate_type TEXT,
    p_aggregate_id UUID,
    p_payload JSONB,
    p_metadata JSONB DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_event_id UUID;
BEGIN
    INSERT INTO inventory.events_outbox (
        tenant_id,
        scope,
        event_type,
        aggregate_type,
        aggregate_id,
        actor_user_id,
        payload,
        metadata
    ) VALUES (
        p_tenant_id,
        p_scope,
        p_event_type,
        p_aggregate_type,
        p_aggregate_id,
        auth.uid(),
        p_payload,
        p_metadata
    ) RETURNING id INTO v_event_id;
    
    RETURN v_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-publish domain events from ledger tables
CREATE OR REPLACE FUNCTION inventory.emit_ledger_event()
RETURNS TRIGGER AS $$
BEGIN
    -- Publish event to outbox for external consumers
    PERFORM inventory.publish_event(
        NEW.tenant_id,
        'tenant',
        NEW.event_type,
        TG_TABLE_NAME,
        NEW.id,
        NEW.payload,
        jsonb_build_object(
            'source', 'inventory_service',
            'occurred_at', NEW.occurred_at,
            'actor_user_id', NEW.actor_user_id
        )
    );
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to inventory_events
CREATE TRIGGER emit_inventory_event_to_outbox
    AFTER INSERT ON inventory.inventory_events
    FOR EACH ROW
    EXECUTE FUNCTION inventory.emit_ledger_event();

-- Apply trigger to asset_events
CREATE TRIGGER emit_asset_event_to_outbox
    AFTER INSERT ON inventory.asset_events
    FOR EACH ROW
    EXECUTE FUNCTION inventory.emit_ledger_event();

-- Apply trigger to procurement_events
CREATE TRIGGER emit_procurement_event_to_outbox
    AFTER INSERT ON inventory.procurement_events
    FOR EACH ROW
    EXECUTE FUNCTION inventory.emit_ledger_event();

-- =====================================================
-- COMMENTS
-- =====================================================
COMMENT ON TABLE inventory.events_outbox IS 'Outbox pattern for publishing domain events to message bus';
COMMENT ON COLUMN inventory.events_outbox.scope IS 'Event scope: tenant (tenant-wide), profile (user-specific), global (system-wide)';
COMMENT ON COLUMN inventory.events_outbox.aggregate_type IS 'Type of aggregate that emitted the event';
COMMENT ON COLUMN inventory.events_outbox.aggregate_id IS 'ID of the aggregate instance';
COMMENT ON FUNCTION inventory.publish_event IS 'Publishes a domain event to the outbox';
