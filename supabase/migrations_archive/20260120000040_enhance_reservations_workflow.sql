-- ============================================================================
-- PHASE 5: RESERVATION ENHANCEMENTS
-- ============================================================================
-- Adds workflow fields for dispatch-safe reservations

-- Add columns
ALTER TABLE inventory.reservations
ADD COLUMN IF NOT EXISTS fulfilled_by_user_id UUID NULL,
ADD COLUMN IF NOT EXISTS cancelled_by_user_id UUID NULL,
ADD COLUMN IF NOT EXISTS expiration_date DATE NULL,
ADD COLUMN IF NOT EXISTS allocation_type TEXT NULL CHECK (allocation_type IS NULL OR allocation_type IN ('job', 'project', 'customer_order', 'internal_order', 'other')),
ADD COLUMN IF NOT EXISTS external_order_ref TEXT NULL;

-- Comments
COMMENT ON COLUMN inventory.reservations.fulfilled_by_user_id IS 'User who fulfilled/issued the reservation';
COMMENT ON COLUMN inventory.reservations.cancelled_by_user_id IS 'User who cancelled the reservation';
COMMENT ON COLUMN inventory.reservations.expiration_date IS 'Auto-cancel if not fulfilled by this date';
COMMENT ON COLUMN inventory.reservations.allocation_type IS 'What the reservation is for (job, project, etc.)';
COMMENT ON COLUMN inventory.reservations.external_order_ref IS 'External reference (job number, order number, etc.)';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_reservations_expiration_date 
    ON inventory.reservations(tenant_id, expiration_date) 
    WHERE expiration_date IS NOT NULL AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_reservations_allocation_type 
    ON inventory.reservations(tenant_id, allocation_type) 
    WHERE allocation_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reservations_external_order_ref 
    ON inventory.reservations(tenant_id, external_order_ref) 
    WHERE external_order_ref IS NOT NULL;

-- View: Expired reservations
CREATE OR REPLACE VIEW inventory.v_reservations_expired AS
SELECT 
    r.id,
    r.tenant_id,
    r.catalog_item_id,
    ci.sku,
    ci.name as item_name,
    r.location_id,
    l.name as location_name,
    r.qty,
    r.expiration_date,
    r.job_ref,
    r.external_order_ref,
    CURRENT_DATE - r.expiration_date as days_overdue
FROM inventory.reservations r
JOIN inventory.catalog_items ci ON ci.id = r.catalog_item_id
JOIN inventory.locations l ON l.id = r.location_id
WHERE r.status = 'active'
AND r.expiration_date IS NOT NULL
AND r.expiration_date < CURRENT_DATE;

COMMENT ON VIEW inventory.v_reservations_expired IS 
    'Reservations that have passed their expiration date and need cancellation';

-- Function to auto-expire reservations
CREATE OR REPLACE FUNCTION inventory.expire_old_reservations(
    p_tenant_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    UPDATE inventory.reservations
    SET 
        status = 'expired',
        updated_at = NOW()
    WHERE status = 'active'
    AND expiration_date IS NOT NULL
    AND expiration_date < CURRENT_DATE
    AND (p_tenant_id IS NULL OR tenant_id = p_tenant_id);
    
    GET DIAGNOSTICS v_count = ROW_COUNT;
    
    RETURN v_count;
END;
$$;

COMMENT ON FUNCTION inventory.expire_old_reservations IS 
    'Auto-expires reservations past their expiration date (run via cron)';

DO $$ BEGIN
    RAISE NOTICE '✅ Reservations enhanced with workflow fields';
END $$;

