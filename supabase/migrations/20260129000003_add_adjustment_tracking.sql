-- Add column to link cycle count lines to their stock adjustment movements
ALTER TABLE inventory.cycle_count_lines
  ADD COLUMN IF NOT EXISTS adjustment_movement_id UUID REFERENCES inventory.stock_movements(id);

COMMENT ON COLUMN inventory.cycle_count_lines.adjustment_movement_id IS 'Link to the stock_movement created when variance was accepted and posted';

-- Create index for quick lookups
CREATE INDEX IF NOT EXISTS idx_cycle_count_lines_adjustment_movement 
  ON inventory.cycle_count_lines(adjustment_movement_id) 
  WHERE adjustment_movement_id IS NOT NULL;
