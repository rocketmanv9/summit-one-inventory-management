-- ============================================================================
-- PHASE 1: CRITICAL IDEMPOTENCY FIX - Purchase Order Lines
-- ============================================================================
-- Adds last_event_id to purchase_order_lines for idempotent processing

-- Add column
ALTER TABLE inventory.purchase_order_lines
ADD COLUMN IF NOT EXISTS last_event_id TEXT NULL;

-- Backfill existing rows with unique legacy IDs
UPDATE inventory.purchase_order_lines
SET last_event_id = 'legacy_po_line_' || id::TEXT
WHERE last_event_id IS NULL;

-- Make NOT NULL
ALTER TABLE inventory.purchase_order_lines
ALTER COLUMN last_event_id SET NOT NULL;

-- Add unique constraint for idempotency
ALTER TABLE inventory.purchase_order_lines
DROP CONSTRAINT IF EXISTS purchase_order_lines_tenant_last_event_id_unique,
ADD CONSTRAINT purchase_order_lines_tenant_last_event_id_unique 
    UNIQUE (tenant_id, last_event_id);

COMMENT ON COLUMN inventory.purchase_order_lines.last_event_id IS 
    'Idempotency key for event-driven processing';

-- Verification
DO $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM inventory.purchase_order_lines
    WHERE last_event_id IS NULL;
    
    IF v_count > 0 THEN
        RAISE EXCEPTION 'Idempotency verification failed: % rows without last_event_id', v_count;
    END IF;
    
    RAISE NOTICE '✅ Purchase order lines idempotency: VERIFIED (all rows have last_event_id)';
END $$;

