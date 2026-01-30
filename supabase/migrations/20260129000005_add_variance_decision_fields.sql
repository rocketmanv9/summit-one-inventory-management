-- Add variance decision tracking to cycle_count_lines
-- This enables explicit accept/investigate/reject decisions on variance

-- Add decision status enum if not exists
DO $$ BEGIN
    CREATE TYPE inventory.variance_decision_status AS ENUM ('pending', 'accepted', 'rejected', 'investigating');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add decision tracking columns
ALTER TABLE inventory.cycle_count_lines
ADD COLUMN IF NOT EXISTS decision_status inventory.variance_decision_status DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS decision_reason TEXT,
ADD COLUMN IF NOT EXISTS decision_notes TEXT,
ADD COLUMN IF NOT EXISTS decided_by_user_id UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;

-- Add index for filtering by decision status
CREATE INDEX IF NOT EXISTS idx_cycle_count_lines_decision_status 
ON inventory.cycle_count_lines(tenant_id, decision_status);

-- Add index for variance requiring decisions
CREATE INDEX IF NOT EXISTS idx_cycle_count_lines_pending_variance 
ON inventory.cycle_count_lines(tenant_id, cycle_count_id) 
WHERE variance <> 0 AND decision_status = 'pending';

COMMENT ON COLUMN inventory.cycle_count_lines.decision_status IS 'Decision status for variance: pending (default), accepted (adjust stock), rejected (invalid count), investigating (needs follow-up)';
COMMENT ON COLUMN inventory.cycle_count_lines.decision_reason IS 'Reason code: usage_not_recorded, transfer_not_recorded, loss_theft, damage_disposal, counting_error, receiving_error, bulk_drift, unknown';
COMMENT ON COLUMN inventory.cycle_count_lines.decision_notes IS 'Free-form notes explaining the variance decision';
