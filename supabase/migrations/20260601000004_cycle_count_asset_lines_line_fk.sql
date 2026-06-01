-- Serialized cycle counting was unworkable: cycle_count_asset_lines had no link to
-- a specific count line (only a `line_number`) AND a UNIQUE (cycle_count_id,
-- line_number) constraint that capped each count line at ONE asset row — so a line
-- could never hold multiple serials. Add a proper cycle_count_line_id FK and drop
-- the blocking unique. (Table is empty in practice — serialized counting never
-- worked — so no backfill is needed, but we backfill defensively by line_number.)

ALTER TABLE inventory.cycle_count_asset_lines
  ADD COLUMN IF NOT EXISTS cycle_count_line_id uuid;

-- Defensive backfill: map any existing rows to a count line by (cycle_count_id, line_number).
UPDATE inventory.cycle_count_asset_lines ccal
SET cycle_count_line_id = ccl.id
FROM inventory.cycle_count_lines ccl
WHERE ccal.cycle_count_line_id IS NULL
  AND ccl.cycle_count_id = ccal.cycle_count_id
  AND ccl.line_number = ccal.line_number;

-- Drop the constraint that limited a count line to a single asset row.
ALTER TABLE inventory.cycle_count_asset_lines
  DROP CONSTRAINT IF EXISTS cycle_count_asset_lines_count_line_unique;

-- line_number is no longer the correlation key; allow it to be null going forward.
ALTER TABLE inventory.cycle_count_asset_lines
  ALTER COLUMN line_number DROP NOT NULL;

-- Add the FK (separate statement so the column add above is committed first).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cycle_count_asset_lines_line_fk'
      AND conrelid = 'inventory.cycle_count_asset_lines'::regclass
  ) THEN
    ALTER TABLE inventory.cycle_count_asset_lines
      ADD CONSTRAINT cycle_count_asset_lines_line_fk
      FOREIGN KEY (cycle_count_line_id)
      REFERENCES inventory.cycle_count_lines(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cc_asset_lines_line
  ON inventory.cycle_count_asset_lines(cycle_count_line_id);
