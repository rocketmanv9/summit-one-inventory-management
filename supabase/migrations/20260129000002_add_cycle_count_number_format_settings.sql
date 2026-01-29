-- Add cycle count number format settings to tenant_settings

ALTER TABLE supply_chain.tenant_settings
ADD COLUMN IF NOT EXISTS cycle_count_number_format TEXT DEFAULT 'date-sequential',
ADD COLUMN IF NOT EXISTS cycle_count_number_prefix TEXT DEFAULT 'CC';

-- Add check constraint for valid formats
ALTER TABLE supply_chain.tenant_settings
ADD CONSTRAINT check_cycle_count_number_format 
CHECK (cycle_count_number_format IN ('date-sequential', 'sequential-year', 'sequential'));

COMMENT ON COLUMN supply_chain.tenant_settings.cycle_count_number_format IS 'Format for cycle count numbers: date-sequential (CC-20260129-00001), sequential-year (CC-26-0001), or sequential (CC-0001)';
COMMENT ON COLUMN supply_chain.tenant_settings.cycle_count_number_prefix IS 'Optional prefix for cycle count numbers (e.g., CC, COUNT)';
