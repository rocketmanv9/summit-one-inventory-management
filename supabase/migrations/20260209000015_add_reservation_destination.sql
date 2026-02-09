-- Add destination location for reservations
ALTER TABLE inventory.reservations
  ADD COLUMN IF NOT EXISTS destination_location_id UUID;

ALTER TABLE inventory.reservations
  ADD CONSTRAINT reservations_destination_location_id_fkey
  FOREIGN KEY (destination_location_id)
  REFERENCES inventory.locations(id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_reservations_destination_location
  ON inventory.reservations (tenant_id, destination_location_id);

COMMENT ON COLUMN inventory.reservations.destination_location_id IS
'Where the reserved stock/asset is needed or will be staged.';
