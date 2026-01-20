-- ============================================================================
-- PHASE 1: CRITICAL IDEMPOTENCY FIX - Cycle Counts
-- ============================================================================
-- Adds last_event_id to cycle_counts and cycle_count_lines

-- =====================================================
-- Add to cycle_counts
-- =====================================================
ALTER TABLE inventory.cycle_counts
ADD COLUMN IF NOT EXISTS last_event_id TEXT NULL;

-- Backfill existing rows
UPDATE inventory.cycle_counts
SET last_event_id = 'legacy_count_' || id::TEXT
WHERE last_event_id IS NULL;

-- Make NOT NULL
ALTER TABLE inventory.cycle_counts
ALTER COLUMN last_event_id SET NOT NULL;

-- Add unique constraint
ALTER TABLE inventory.cycle_counts
DROP CONSTRAINT IF EXISTS cycle_counts_tenant_last_event_id_unique,
ADD CONSTRAINT cycle_counts_tenant_last_event_id_unique 
    UNIQUE (tenant_id, last_event_id);

COMMENT ON COLUMN inventory.cycle_counts.last_event_id IS 
    'Idempotency key for cycle count creation';

-- =====================================================
-- Add to cycle_count_lines
-- =====================================================
ALTER TABLE inventory.cycle_count_lines
ADD COLUMN IF NOT EXISTS last_event_id TEXT NULL;

-- Backfill existing rows
UPDATE inventory.cycle_count_lines
SET last_event_id = 'legacy_count_line_' || id::TEXT
WHERE last_event_id IS NULL;

-- Make NOT NULL
ALTER TABLE inventory.cycle_count_lines
ALTER COLUMN last_event_id SET NOT NULL;

-- Add unique constraint
ALTER TABLE inventory.cycle_count_lines
DROP CONSTRAINT IF EXISTS cycle_count_lines_tenant_last_event_id_unique,
ADD CONSTRAINT cycle_count_lines_tenant_last_event_id_unique 
    UNIQUE (tenant_id, last_event_id);

COMMENT ON COLUMN inventory.cycle_count_lines.last_event_id IS 
    'Idempotency key for count line submission';

-- Verification
DO $$
DECLARE
    v_count_headers INTEGER;
    v_count_lines INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count_headers
    FROM inventory.cycle_counts
    WHERE last_event_id IS NULL;
    
    SELECT COUNT(*) INTO v_count_lines
    FROM inventory.cycle_count_lines
    WHERE last_event_id IS NULL;
    
    IF v_count_headers > 0 OR v_count_lines > 0 THEN
        RAISE EXCEPTION 'Idempotency verification failed: % headers, % lines without last_event_id', 
            v_count_headers, v_count_lines;
    END IF;
    
    RAISE NOTICE '✅ Cycle counts idempotency: VERIFIED';
    RAISE NOTICE '   - cycle_counts: all rows have last_event_id';
    RAISE NOTICE '   - cycle_count_lines: all rows have last_event_id';
END $$;

