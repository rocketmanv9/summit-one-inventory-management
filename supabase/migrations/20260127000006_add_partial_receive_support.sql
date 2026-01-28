-- Add partial receive capability to transfers
-- Add qty_shipped and qty_received to track partial shipments/receives
-- Add partially_received status

-- 1. Add new columns to transfer_lines
ALTER TABLE inventory.transfer_lines 
ADD COLUMN IF NOT EXISTS qty_shipped NUMERIC(18,4) DEFAULT 0 NOT NULL,
ADD COLUMN IF NOT EXISTS qty_received NUMERIC(18,4) DEFAULT 0 NOT NULL;

-- 2. Add check constraints
ALTER TABLE inventory.transfer_lines
ADD CONSTRAINT transfer_lines_qty_shipped_check CHECK (qty_shipped >= 0 AND qty_shipped <= qty),
ADD CONSTRAINT transfer_lines_qty_received_check CHECK (qty_received >= 0 AND qty_received <= qty_shipped);

-- 3. Update transfers status constraint to include partially_received
ALTER TABLE inventory.transfers
DROP CONSTRAINT IF EXISTS transfers_status_check;

ALTER TABLE inventory.transfers
ADD CONSTRAINT transfers_status_check CHECK (status = ANY (ARRAY['draft'::text, 'in_transit'::text, 'partially_received'::text, 'completed'::text, 'cancelled'::text]));

-- 4. Add reversal reference columns
ALTER TABLE inventory.transfers
ADD COLUMN IF NOT EXISTS reversal_of_transfer_id UUID REFERENCES inventory.transfers(id),
ADD COLUMN IF NOT EXISTS is_reversal BOOLEAN DEFAULT false NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transfers_reversal ON inventory.transfers(reversal_of_transfer_id) WHERE reversal_of_transfer_id IS NOT NULL;

COMMENT ON COLUMN inventory.transfer_lines.qty_shipped IS 'Quantity actually shipped (can be less than qty for partial shipments)';
COMMENT ON COLUMN inventory.transfer_lines.qty_received IS 'Quantity received so far (can be less than qty_shipped for partial receives)';
COMMENT ON COLUMN inventory.transfers.reversal_of_transfer_id IS 'Reference to original transfer if this is a reversal/return';
COMMENT ON COLUMN inventory.transfers.is_reversal IS 'True if this transfer reverses a previous transfer';
