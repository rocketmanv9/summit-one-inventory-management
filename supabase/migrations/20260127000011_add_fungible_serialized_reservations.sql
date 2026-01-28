-- =====================================================
-- MIGRATION: Support Fungible vs Serialized Reservations
-- =====================================================
-- Purpose: Enable reservations for both:
--   1) Fungible stock (qty-based, e.g., rakes, cones)
--   2) Serialized assets (asset-specific, e.g., trailers, iPads)
-- 
-- Design principles:
--   - Additive only (no table recreation)
--   - Mutual exclusivity enforced via constraint
--   - Time window support for future scheduling
--   - Full tenant isolation via RLS
--   - Event-driven with idempotency
-- =====================================================

-- =====================================================
-- STEP 1: Add tracking_mode to catalog_items (if not exists)
-- =====================================================
-- Note: tracking_mode already exists in schema with values:
--   'stock', 'serialized', 'both'
-- We'll standardize to: 'fungible', 'serialized', 'hybrid'
-- But keep backward compatibility

DO $$ 
BEGIN
    -- Check if we need to update the constraint
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'catalog_items_tracking_mode_check'
        AND conrelid = 'inventory.catalog_items'::regclass
    ) THEN
        -- Drop old constraint
        ALTER TABLE inventory.catalog_items 
        DROP CONSTRAINT catalog_items_tracking_mode_check;
    END IF;
END $$;

-- Add new constraint with extended values
ALTER TABLE inventory.catalog_items
ADD CONSTRAINT catalog_items_tracking_mode_check 
CHECK (tracking_mode IN ('stock', 'serialized', 'both', 'fungible', 'hybrid', 'consumable'));

COMMENT ON COLUMN inventory.catalog_items.tracking_mode IS 
'Tracking mode: consumable (reduce on use), fungible/stock (reserve by qty), serialized (reserve by asset), hybrid/both (supports either)';


-- =====================================================
-- STEP 2: Extend reservations table for dual-mode support
-- =====================================================

-- Add asset_id for serialized reservations
ALTER TABLE inventory.reservations
ADD COLUMN IF NOT EXISTS asset_id UUID REFERENCES inventory.assets(id) ON DELETE CASCADE;

-- Add time window support (nullable for backward compatibility)
ALTER TABLE inventory.reservations
ADD COLUMN IF NOT EXISTS reserved_from TIMESTAMP WITH TIME ZONE;

ALTER TABLE inventory.reservations
ADD COLUMN IF NOT EXISTS reserved_until TIMESTAMP WITH TIME ZONE;

-- Add reservation_type to make the mode explicit
ALTER TABLE inventory.reservations
ADD COLUMN IF NOT EXISTS reservation_type TEXT 
CHECK (reservation_type IN ('fungible', 'serialized'));

-- Backfill existing reservations as 'fungible'
UPDATE inventory.reservations
SET reservation_type = 'fungible'
WHERE reservation_type IS NULL;

-- Make reservation_type required going forward
ALTER TABLE inventory.reservations
ALTER COLUMN reservation_type SET NOT NULL;

-- Add notes field for reservation-specific context
ALTER TABLE inventory.reservations
ADD COLUMN IF NOT EXISTS notes TEXT;

COMMENT ON COLUMN inventory.reservations.asset_id IS 
'For serialized reservations: specific asset being reserved (mutually exclusive with qty > 1)';

COMMENT ON COLUMN inventory.reservations.reserved_from IS 
'Start of reservation time window (nullable for immediate/indefinite reservations)';

COMMENT ON COLUMN inventory.reservations.reserved_until IS 
'End of reservation time window (nullable for indefinite reservations)';

COMMENT ON COLUMN inventory.reservations.reservation_type IS 
'Type of reservation: fungible (qty-based) or serialized (asset-specific)';

COMMENT ON COLUMN inventory.reservations.notes IS 
'Additional context or instructions for this reservation';


-- =====================================================
-- STEP 3: Add mutual exclusivity constraint
-- =====================================================

-- Drop existing qty constraint temporarily
ALTER TABLE inventory.reservations
DROP CONSTRAINT IF EXISTS chk_reservation_qty_positive;

ALTER TABLE inventory.reservations
DROP CONSTRAINT IF EXISTS reservations_qty_check;

-- Add comprehensive validation constraint
ALTER TABLE inventory.reservations
ADD CONSTRAINT chk_reservation_mode_validity CHECK (
    CASE 
        -- Fungible: must have qty, catalog_item_id, location_id; asset_id should be null
        WHEN reservation_type = 'fungible' THEN 
            (qty > 0 AND catalog_item_id IS NOT NULL AND location_id IS NOT NULL AND asset_id IS NULL)
        -- Serialized: must have asset_id; qty should be 1 or null; catalog_item_id optional but recommended
        WHEN reservation_type = 'serialized' THEN 
            (asset_id IS NOT NULL AND (qty IS NULL OR qty = 1))
        ELSE false
    END
);

COMMENT ON CONSTRAINT chk_reservation_mode_validity ON inventory.reservations IS 
'Enforces mutual exclusivity: fungible reservations use qty + catalog_item_id + location_id; serialized reservations use asset_id';


-- =====================================================
-- STEP 4: Add time window overlap constraint for assets
-- =====================================================

-- Create partial unique index to prevent double-booking of assets
-- Only enforces when both reserved_from and reserved_until are specified
CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_reservation_no_overlap
ON inventory.reservations (tenant_id, asset_id, reserved_from, reserved_until)
WHERE reservation_type = 'serialized' 
  AND status = 'active' 
  AND reserved_from IS NOT NULL 
  AND reserved_until IS NOT NULL;

COMMENT ON INDEX inventory.idx_asset_reservation_no_overlap IS 
'Prevents double-booking of serialized assets in the same time window';

-- Create exclusion constraint for overlapping time ranges (PostgreSQL 14+)
-- This prevents ANY overlap, not just exact duplicates
-- Note: Requires btree_gist extension
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE inventory.reservations
DROP CONSTRAINT IF EXISTS chk_no_asset_time_overlap;

ALTER TABLE inventory.reservations
ADD CONSTRAINT chk_no_asset_time_overlap 
EXCLUDE USING gist (
    tenant_id WITH =,
    asset_id WITH =,
    tstzrange(reserved_from, reserved_until, '[)') WITH &&
)
WHERE (reservation_type = 'serialized' AND status = 'active' AND reserved_from IS NOT NULL AND reserved_until IS NOT NULL);

COMMENT ON CONSTRAINT chk_no_asset_time_overlap ON inventory.reservations IS 
'Prevents overlapping time windows for the same asset (uses exclusion constraint)';


-- =====================================================
-- STEP 5: Add indexes for performance
-- =====================================================

-- Index for finding available assets of a specific type
CREATE INDEX IF NOT EXISTS idx_reservations_asset_id_status 
ON inventory.reservations (tenant_id, asset_id, status)
WHERE reservation_type = 'serialized';

-- Index for fungible reservations by item/location
CREATE INDEX IF NOT EXISTS idx_reservations_fungible_lookup
ON inventory.reservations (tenant_id, catalog_item_id, location_id, status)
WHERE reservation_type = 'fungible';

-- Index for time window queries
CREATE INDEX IF NOT EXISTS idx_reservations_time_window
ON inventory.reservations (tenant_id, reserved_from, reserved_until)
WHERE reserved_from IS NOT NULL AND reserved_until IS NOT NULL;

-- Index for expiration cleanup
CREATE INDEX IF NOT EXISTS idx_reservations_expiration
ON inventory.reservations (tenant_id, expiration_date, status)
WHERE expiration_date IS NOT NULL AND status = 'active';


-- =====================================================
-- STEP 6: Update RLS policies (already tenant-isolated)
-- =====================================================
-- Existing policies already cover tenant_id isolation:
--   - reservations_tenant_isolation
--   - reservations_service_role
-- No changes needed


-- =====================================================
-- STEP 7: Create validation functions
-- =====================================================

-- Function: Check if fungible stock is available for reservation
CREATE OR REPLACE FUNCTION inventory.validate_fungible_reservation_availability(
    p_tenant_id UUID,
    p_catalog_item_id UUID,
    p_location_id UUID,
    p_qty NUMERIC,
    p_exclude_reservation_id UUID DEFAULT NULL
)
RETURNS TABLE (
    available_qty NUMERIC,
    is_available BOOLEAN,
    message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
    v_qty_on_hand NUMERIC;
    v_qty_reserved NUMERIC;
    v_qty_available NUMERIC;
    v_item_name TEXT;
    v_location_name TEXT;
BEGIN
    -- Get stock balance and descriptive info
    SELECT 
        COALESCE(sb.qty_on_hand, 0),
        COALESCE(sb.qty_reserved, 0),
        COALESCE(sb.qty_available, 0),
        ci.name,
        l.name
    INTO 
        v_qty_on_hand,
        v_qty_reserved,
        v_qty_available,
        v_item_name,
        v_location_name
    FROM inventory.stock_balances sb
    LEFT JOIN inventory.catalog_items ci ON ci.id = p_catalog_item_id AND ci.tenant_id = p_tenant_id
    LEFT JOIN inventory.locations l ON l.id = p_location_id AND l.tenant_id = p_tenant_id
    WHERE sb.tenant_id = p_tenant_id
      AND sb.catalog_item_id = p_catalog_item_id
      AND sb.location_id = p_location_id;
    
    -- Default to 0 if no stock balance exists
    v_qty_available := COALESCE(v_qty_available, 0);
    
    -- If excluding an existing reservation (for updates), add its qty back
    IF p_exclude_reservation_id IS NOT NULL THEN
        DECLARE
            v_excluded_qty NUMERIC;
        BEGIN
            SELECT qty INTO v_excluded_qty
            FROM inventory.reservations
            WHERE id = p_exclude_reservation_id
              AND tenant_id = p_tenant_id
              AND reservation_type = 'fungible';
            
            v_qty_available := v_qty_available + COALESCE(v_excluded_qty, 0);
        END;
    END IF;
    
    -- Return result
    RETURN QUERY SELECT 
        v_qty_available AS available_qty,
        (v_qty_available >= p_qty) AS is_available,
        CASE 
            WHEN v_qty_available >= p_qty THEN 
                format('✓ Available: %s units of "%s" at "%s"', v_qty_available, v_item_name, v_location_name)
            ELSE 
                format('✗ Insufficient stock: %s units requested but only %s available for "%s" at "%s"', 
                       p_qty, v_qty_available, v_item_name, v_location_name)
        END AS message;
END;
$$;

COMMENT ON FUNCTION inventory.validate_fungible_reservation_availability IS 
'Checks if sufficient fungible stock is available for reservation (tenant-scoped, concurrency-safe)';


-- Function: Check if serialized asset is available for reservation
CREATE OR REPLACE FUNCTION inventory.validate_asset_reservation_availability(
    p_tenant_id UUID,
    p_asset_id UUID,
    p_reserved_from TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    p_reserved_until TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    p_exclude_reservation_id UUID DEFAULT NULL
)
RETURNS TABLE (
    is_available BOOLEAN,
    conflicting_reservation_id UUID,
    message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
    v_asset RECORD;
    v_conflict RECORD;
BEGIN
    -- Get asset info
    SELECT 
        a.id,
        a.asset_tag,
        a.status,
        ci.name AS item_name
    INTO v_asset
    FROM inventory.assets a
    LEFT JOIN inventory.catalog_items ci ON ci.id = a.catalog_item_id
    WHERE a.id = p_asset_id
      AND a.tenant_id = p_tenant_id;
    
    IF NOT FOUND THEN
        RETURN QUERY SELECT 
            false AS is_available,
            NULL::UUID AS conflicting_reservation_id,
            format('✗ Asset not found or access denied') AS message;
        RETURN;
    END IF;
    
    -- Check asset status
    IF v_asset.status NOT IN ('available', 'assigned') THEN
        RETURN QUERY SELECT 
            false AS is_available,
            NULL::UUID AS conflicting_reservation_id,
            format('✗ Asset "%s" is %s (not available)', v_asset.asset_tag, v_asset.status) AS message;
        RETURN;
    END IF;
    
    -- Check for overlapping reservations
    IF p_reserved_from IS NOT NULL AND p_reserved_until IS NOT NULL THEN
        -- Time window specified - check for overlaps
        SELECT r.id, r.reserved_from, r.reserved_until
        INTO v_conflict
        FROM inventory.reservations r
        WHERE r.tenant_id = p_tenant_id
          AND r.asset_id = p_asset_id
          AND r.reservation_type = 'serialized'
          AND r.status = 'active'
          AND r.reserved_from IS NOT NULL
          AND r.reserved_until IS NOT NULL
          AND (r.id != p_exclude_reservation_id OR p_exclude_reservation_id IS NULL)
          AND tstzrange(r.reserved_from, r.reserved_until, '[)') && tstzrange(p_reserved_from, p_reserved_until, '[)')
        LIMIT 1;
        
        IF FOUND THEN
            RETURN QUERY SELECT 
                false AS is_available,
                v_conflict.id AS conflicting_reservation_id,
                format('✗ Asset "%s" already reserved from %s to %s', 
                       v_asset.asset_tag, 
                       v_conflict.reserved_from::TEXT, 
                       v_conflict.reserved_until::TEXT) AS message;
            RETURN;
        END IF;
    ELSE
        -- No time window - check for any active reservation
        SELECT r.id
        INTO v_conflict
        FROM inventory.reservations r
        WHERE r.tenant_id = p_tenant_id
          AND r.asset_id = p_asset_id
          AND r.reservation_type = 'serialized'
          AND r.status = 'active'
          AND (r.id != p_exclude_reservation_id OR p_exclude_reservation_id IS NULL)
        LIMIT 1;
        
        IF FOUND THEN
            RETURN QUERY SELECT 
                false AS is_available,
                v_conflict.id AS conflicting_reservation_id,
                format('✗ Asset "%s" is already reserved', v_asset.asset_tag) AS message;
            RETURN;
        END IF;
    END IF;
    
    -- Asset is available
    RETURN QUERY SELECT 
        true AS is_available,
        NULL::UUID AS conflicting_reservation_id,
        format('✓ Asset "%s" (%s) is available', v_asset.asset_tag, v_asset.item_name) AS message;
END;
$$;

COMMENT ON FUNCTION inventory.validate_asset_reservation_availability IS 
'Checks if serialized asset is available for reservation (supports time windows, tenant-scoped)';


-- =====================================================
-- STEP 8: Create reservation RPC functions
-- =====================================================

-- Function: Create fungible stock reservation
CREATE OR REPLACE FUNCTION inventory.rpc_inv_reserve_fungible(
    p_tenant_id UUID,
    p_catalog_item_id UUID,
    p_location_id UUID,
    p_qty NUMERIC,
    p_allocation_type TEXT DEFAULT NULL,
    p_job_ref JSONB DEFAULT NULL,
    p_external_order_ref TEXT DEFAULT NULL,
    p_needed_by DATE DEFAULT NULL,
    p_expiration_date DATE DEFAULT NULL,
    p_reserved_from TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    p_reserved_until TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_last_event_id TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_reservation_id UUID;
    v_event_id TEXT;
    v_validation RECORD;
BEGIN
    -- Validate inputs
    IF p_tenant_id IS NULL OR p_catalog_item_id IS NULL OR p_location_id IS NULL OR p_qty IS NULL THEN
        RAISE EXCEPTION 'tenant_id, catalog_item_id, location_id, and qty are required'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    
    IF p_qty <= 0 THEN
        RAISE EXCEPTION 'qty must be greater than 0'
        USING ERRCODE = 'check_violation';
    END IF;
    
    -- Generate event ID (idempotency key)
    v_event_id := COALESCE(p_last_event_id, 'reserve_fungible_' || gen_random_uuid()::TEXT);
    
    -- Validate availability
    SELECT * INTO v_validation
    FROM inventory.validate_fungible_reservation_availability(
        p_tenant_id,
        p_catalog_item_id,
        p_location_id,
        p_qty
    );
    
    IF NOT v_validation.is_available THEN
        RAISE EXCEPTION '%', v_validation.message
        USING ERRCODE = 'check_violation',
              HINT = 'Check stock levels or receive more inventory';
    END IF;
    
    -- Create reservation (idempotent on last_event_id)
    INSERT INTO inventory.reservations (
        tenant_id,
        catalog_item_id,
        location_id,
        qty,
        asset_id,
        reservation_type,
        status,
        allocation_type,
        job_ref,
        external_order_ref,
        needed_by,
        expiration_date,
        reserved_from,
        reserved_until,
        notes,
        last_event_id
    ) VALUES (
        p_tenant_id,
        p_catalog_item_id,
        p_location_id,
        p_qty,
        NULL, -- No asset_id for fungible
        'fungible',
        'active',
        p_allocation_type,
        p_job_ref,
        p_external_order_ref,
        p_needed_by,
        p_expiration_date,
        p_reserved_from,
        p_reserved_until,
        p_notes,
        v_event_id
    )
    ON CONFLICT (tenant_id, last_event_id) DO NOTHING
    RETURNING id INTO v_reservation_id;
    
    -- If no ID returned, reservation already exists (idempotent)
    IF v_reservation_id IS NULL THEN
        SELECT id INTO v_reservation_id
        FROM inventory.reservations
        WHERE tenant_id = p_tenant_id
          AND last_event_id = v_event_id;
        
        RETURN v_reservation_id;
    END IF;
    
    -- Update stock_balances.qty_reserved
    INSERT INTO inventory.stock_balances (
        tenant_id,
        catalog_item_id,
        location_id,
        qty_on_hand,
        qty_reserved
    ) VALUES (
        p_tenant_id,
        p_catalog_item_id,
        p_location_id,
        0,
        p_qty
    )
    ON CONFLICT (tenant_id, catalog_item_id, location_id)
    DO UPDATE SET
        qty_reserved = inventory.stock_balances.qty_reserved + EXCLUDED.qty_reserved,
        updated_at = NOW();
    
    -- Publish event
    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id,
        p_scope => 'tenant',
        p_event_type => 'reservation.created.fungible',
        p_aggregate_type => 'reservation',
        p_aggregate_id => v_reservation_id,
        p_payload => jsonb_build_object(
            'reservation_id', v_reservation_id,
            'reservation_type', 'fungible',
            'catalog_item_id', p_catalog_item_id,
            'location_id', p_location_id,
            'qty', p_qty,
            'allocation_type', p_allocation_type,
            'external_order_ref', p_external_order_ref,
            'reserved_from', p_reserved_from,
            'reserved_until', p_reserved_until
        )
    );
    
    RETURN v_reservation_id;
END;
$$;

COMMENT ON FUNCTION inventory.rpc_inv_reserve_fungible IS 
'Creates fungible (qty-based) reservation with availability validation (idempotent, tenant-scoped)';


-- Function: Create serialized asset reservation
CREATE OR REPLACE FUNCTION inventory.rpc_inv_reserve_asset(
    p_tenant_id UUID,
    p_asset_id UUID,
    p_allocation_type TEXT DEFAULT NULL,
    p_job_ref JSONB DEFAULT NULL,
    p_external_order_ref TEXT DEFAULT NULL,
    p_needed_by DATE DEFAULT NULL,
    p_expiration_date DATE DEFAULT NULL,
    p_reserved_from TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    p_reserved_until TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_last_event_id TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_reservation_id UUID;
    v_event_id TEXT;
    v_validation RECORD;
    v_asset RECORD;
BEGIN
    -- Validate inputs
    IF p_tenant_id IS NULL OR p_asset_id IS NULL THEN
        RAISE EXCEPTION 'tenant_id and asset_id are required'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    
    -- Generate event ID (idempotency key)
    v_event_id := COALESCE(p_last_event_id, 'reserve_asset_' || gen_random_uuid()::TEXT);
    
    -- Get asset details
    SELECT 
        a.id,
        a.catalog_item_id,
        a.location_id,
        a.asset_tag
    INTO v_asset
    FROM inventory.assets a
    WHERE a.id = p_asset_id
      AND a.tenant_id = p_tenant_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Asset not found or access denied'
        USING ERRCODE = 'no_data_found';
    END IF;
    
    -- Validate availability
    SELECT * INTO v_validation
    FROM inventory.validate_asset_reservation_availability(
        p_tenant_id,
        p_asset_id,
        p_reserved_from,
        p_reserved_until
    );
    
    IF NOT v_validation.is_available THEN
        RAISE EXCEPTION '%', v_validation.message
        USING ERRCODE = 'check_violation',
              HINT = 'Choose a different asset or time window';
    END IF;
    
    -- Create reservation (idempotent on last_event_id)
    INSERT INTO inventory.reservations (
        tenant_id,
        catalog_item_id,
        location_id,
        qty,
        asset_id,
        reservation_type,
        status,
        allocation_type,
        job_ref,
        external_order_ref,
        needed_by,
        expiration_date,
        reserved_from,
        reserved_until,
        notes,
        last_event_id
    ) VALUES (
        p_tenant_id,
        v_asset.catalog_item_id, -- Inherit from asset
        v_asset.location_id, -- Inherit from asset
        1, -- Always 1 for serialized
        p_asset_id,
        'serialized',
        'active',
        p_allocation_type,
        p_job_ref,
        p_external_order_ref,
        p_needed_by,
        p_expiration_date,
        p_reserved_from,
        p_reserved_until,
        p_notes,
        v_event_id
    )
    ON CONFLICT (tenant_id, last_event_id) DO NOTHING
    RETURNING id INTO v_reservation_id;
    
    -- If no ID returned, reservation already exists (idempotent)
    IF v_reservation_id IS NULL THEN
        SELECT id INTO v_reservation_id
        FROM inventory.reservations
        WHERE tenant_id = p_tenant_id
          AND last_event_id = v_event_id;
        
        RETURN v_reservation_id;
    END IF;
    
    -- Update asset status to 'assigned' (optional, based on business rules)
    UPDATE inventory.assets
    SET 
        status = 'assigned',
        updated_at = NOW()
    WHERE id = p_asset_id
      AND tenant_id = p_tenant_id;
    
    -- Publish event
    PERFORM inventory.publish_event(
        p_tenant_id => p_tenant_id,
        p_scope => 'tenant',
        p_event_type => 'reservation.created.serialized',
        p_aggregate_type => 'reservation',
        p_aggregate_id => v_reservation_id,
        p_payload => jsonb_build_object(
            'reservation_id', v_reservation_id,
            'reservation_type', 'serialized',
            'asset_id', p_asset_id,
            'asset_tag', v_asset.asset_tag,
            'catalog_item_id', v_asset.catalog_item_id,
            'location_id', v_asset.location_id,
            'allocation_type', p_allocation_type,
            'external_order_ref', p_external_order_ref,
            'reserved_from', p_reserved_from,
            'reserved_until', p_reserved_until
        )
    );
    
    RETURN v_reservation_id;
END;
$$;

COMMENT ON FUNCTION inventory.rpc_inv_reserve_asset IS 
'Creates serialized (asset-specific) reservation with overlap validation (idempotent, tenant-scoped)';


-- =====================================================
-- STEP 9: Helper query functions
-- =====================================================

-- Function: Find available assets of a given type
CREATE OR REPLACE FUNCTION inventory.rpc_inv_find_available_assets(
    p_tenant_id UUID,
    p_catalog_item_id UUID,
    p_location_id UUID DEFAULT NULL,
    p_reserved_from TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    p_reserved_until TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    p_limit INT DEFAULT 50
)
RETURNS TABLE (
    asset_id UUID,
    asset_tag TEXT,
    serial_number TEXT,
    status TEXT,
    location_id UUID,
    location_name TEXT,
    is_available BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        a.id AS asset_id,
        a.asset_tag,
        a.serial_number,
        a.status,
        a.location_id,
        l.name AS location_name,
        NOT EXISTS (
            SELECT 1
            FROM inventory.reservations r
            WHERE r.tenant_id = p_tenant_id
              AND r.asset_id = a.id
              AND r.reservation_type = 'serialized'
              AND r.status = 'active'
              AND (
                  -- If time window specified, check for overlap
                  (p_reserved_from IS NOT NULL AND p_reserved_until IS NOT NULL
                   AND r.reserved_from IS NOT NULL AND r.reserved_until IS NOT NULL
                   AND tstzrange(r.reserved_from, r.reserved_until, '[)') && tstzrange(p_reserved_from, p_reserved_until, '[)'))
                  OR
                  -- If no time window, just check if any active reservation exists
                  (p_reserved_from IS NULL OR p_reserved_until IS NULL)
              )
        ) AS is_available
    FROM inventory.assets a
    LEFT JOIN inventory.locations l ON l.id = a.location_id AND l.tenant_id = p_tenant_id
    WHERE a.tenant_id = p_tenant_id
      AND a.catalog_item_id = p_catalog_item_id
      AND (p_location_id IS NULL OR a.location_id = p_location_id)
      AND a.status IN ('available', 'assigned')
    ORDER BY a.asset_tag
    LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION inventory.rpc_inv_find_available_assets IS 
'Finds available serialized assets of a given type (supports time window filtering)';


-- =====================================================
-- STEP 10: Update existing reservation validation trigger
-- =====================================================

-- Drop old trigger if exists
DROP TRIGGER IF EXISTS validate_reservation_availability ON inventory.reservations;

-- Create new validation trigger that handles both modes
CREATE OR REPLACE FUNCTION inventory.trg_validate_reservation_before_insert()
RETURNS TRIGGER AS $$
DECLARE
    v_fungible_validation RECORD;
    v_asset_validation RECORD;
BEGIN
    -- Only validate for active reservations
    IF NEW.status != 'active' THEN
        RETURN NEW;
    END IF;
    
    -- Validate based on reservation type
    IF NEW.reservation_type = 'fungible' THEN
        -- Validate fungible stock availability
        SELECT * INTO v_fungible_validation
        FROM inventory.validate_fungible_reservation_availability(
            NEW.tenant_id,
            NEW.catalog_item_id,
            NEW.location_id,
            NEW.qty
        );
        
        IF NOT v_fungible_validation.is_available THEN
            RAISE EXCEPTION '%', v_fungible_validation.message
            USING ERRCODE = 'check_violation',
                  HINT = 'Check stock availability before creating reservation';
        END IF;
        
    ELSIF NEW.reservation_type = 'serialized' THEN
        -- Validate asset availability
        SELECT * INTO v_asset_validation
        FROM inventory.validate_asset_reservation_availability(
            NEW.tenant_id,
            NEW.asset_id,
            NEW.reserved_from,
            NEW.reserved_until
        );
        
        IF NOT v_asset_validation.is_available THEN
            RAISE EXCEPTION '%', v_asset_validation.message
            USING ERRCODE = 'check_violation',
                  HINT = 'Choose a different asset or time window';
        END IF;
    ELSE
        RAISE EXCEPTION 'Invalid reservation_type: %', NEW.reservation_type
        USING ERRCODE = 'check_violation';
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER validate_reservation_availability
    BEFORE INSERT ON inventory.reservations
    FOR EACH ROW
    EXECUTE FUNCTION inventory.trg_validate_reservation_before_insert();

COMMENT ON FUNCTION inventory.trg_validate_reservation_before_insert IS 
'Validates both fungible and serialized reservations before insert';


-- =====================================================
-- STEP 11: Add helper view for reservation summary
-- =====================================================

CREATE OR REPLACE VIEW inventory.v_reservation_summary AS
SELECT 
    r.id,
    r.tenant_id,
    r.reservation_type,
    r.status,
    r.catalog_item_id,
    ci.sku,
    ci.name AS item_name,
    r.location_id,
    l.name AS location_name,
    r.qty,
    r.asset_id,
    a.asset_tag,
    a.serial_number,
    r.allocation_type,
    r.external_order_ref,
    r.needed_by,
    r.expiration_date,
    r.reserved_from,
    r.reserved_until,
    r.notes,
    r.created_at,
    r.fulfilled_at,
    CASE 
        WHEN r.status = 'active' AND r.expiration_date IS NOT NULL AND r.expiration_date < CURRENT_DATE 
        THEN true
        ELSE false
    END AS is_expired,
    CASE 
        WHEN r.reservation_type = 'serialized' AND r.reserved_from IS NOT NULL AND r.reserved_until IS NOT NULL
        THEN tstzrange(r.reserved_from, r.reserved_until, '[)')
        ELSE NULL
    END AS time_window
FROM inventory.reservations r
LEFT JOIN inventory.catalog_items ci ON ci.id = r.catalog_item_id AND ci.tenant_id = r.tenant_id
LEFT JOIN inventory.locations l ON l.id = r.location_id AND l.tenant_id = r.tenant_id
LEFT JOIN inventory.assets a ON a.id = r.asset_id AND a.tenant_id = r.tenant_id;

COMMENT ON VIEW inventory.v_reservation_summary IS 
'Unified view of both fungible and serialized reservations with denormalized details';


-- =====================================================
-- MIGRATION COMPLETE
-- =====================================================

-- Add migration tracking comment
COMMENT ON TABLE inventory.reservations IS 
'Active reservations/allocations - supports both fungible (qty-based) and serialized (asset-specific) reservations with optional time windows';
