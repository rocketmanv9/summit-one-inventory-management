-- Reservation types: tenant-configurable allocation types with global defaults
CREATE TABLE IF NOT EXISTS inventory.reservation_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NULL,
    type_key TEXT NOT NULL,
    display_name TEXT NOT NULL,
    is_system BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    description TEXT NULL,
    last_event_id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by_user_id UUID NULL
);

-- Uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS reservation_types_global_unique
    ON inventory.reservation_types(type_key)
    WHERE tenant_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS reservation_types_tenant_unique
    ON inventory.reservation_types(tenant_id, type_key)
    WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reservation_types_tenant
    ON inventory.reservation_types(tenant_id, sort_order);

COMMENT ON TABLE inventory.reservation_types IS
    'Tenant-configurable reservation allocation types with global defaults.';
COMMENT ON COLUMN inventory.reservation_types.type_key IS
    'Unique identifier for allocation type (lowercase, no spaces).';
COMMENT ON COLUMN inventory.reservation_types.is_system IS
    'Global/system types cannot be modified by tenants.';

-- Seed global defaults
INSERT INTO inventory.reservation_types (tenant_id, type_key, display_name, is_system, sort_order, description)
SELECT * FROM (
    VALUES
      (NULL::UUID, 'job', 'Job', true, 10, 'Reserved for a job'),
      (NULL::UUID, 'project', 'Project', true, 20, 'Reserved for a project'),
      (NULL::UUID, 'customer_order', 'Customer Order', true, 30, 'Reserved for a customer order'),
      (NULL::UUID, 'internal_order', 'Internal Order', true, 40, 'Reserved for internal use'),
      (NULL::UUID, 'other', 'Other', true, 50, 'Other or uncategorized')
) AS defaults(tenant_id, type_key, display_name, is_system, sort_order, description)
WHERE NOT EXISTS (
    SELECT 1 FROM inventory.reservation_types t
    WHERE t.tenant_id IS NULL AND t.type_key = defaults.type_key
);

-- RLS
ALTER TABLE inventory.reservation_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY reservation_types_select ON inventory.reservation_types
    FOR SELECT
    USING (tenant_id = current_tenant_id() OR tenant_id IS NULL);

CREATE POLICY reservation_types_insert ON inventory.reservation_types
    FOR INSERT
    WITH CHECK (tenant_id = current_tenant_id() AND is_system = false);

CREATE POLICY reservation_types_update ON inventory.reservation_types
    FOR UPDATE
    USING (tenant_id = current_tenant_id() AND is_system = false)
    WITH CHECK (tenant_id = current_tenant_id() AND is_system = false);

CREATE POLICY reservation_types_delete ON inventory.reservation_types
    FOR DELETE
    USING (tenant_id = current_tenant_id() AND is_system = false);

GRANT SELECT, INSERT, UPDATE ON inventory.reservation_types TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON inventory.reservation_types TO service_role;

-- Maintain updated_at
DROP TRIGGER IF EXISTS update_reservation_types_updated_at ON inventory.reservation_types;
CREATE TRIGGER update_reservation_types_updated_at
  BEFORE UPDATE ON inventory.reservation_types
  FOR EACH ROW
  EXECUTE FUNCTION inventory.update_updated_at_column();

-- Remove restrictive allocation_type check on reservations
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'reservations_allocation_type_check'
          AND table_schema = 'inventory'
          AND table_name = 'reservations'
    ) THEN
        ALTER TABLE inventory.reservations
            DROP CONSTRAINT reservations_allocation_type_check;
    END IF;
END $$;

-- Validate allocation_type against reservation_types
CREATE OR REPLACE FUNCTION inventory.validate_reservation_allocation_type()
RETURNS TRIGGER AS $$
DECLARE
    v_type_exists BOOLEAN;
BEGIN
    IF NEW.allocation_type IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT EXISTS(
        SELECT 1 FROM inventory.reservation_types
        WHERE type_key = NEW.allocation_type
          AND is_active = true
          AND (tenant_id = NEW.tenant_id OR tenant_id IS NULL)
    ) INTO v_type_exists;

    IF NOT v_type_exists THEN
        RAISE EXCEPTION 'Invalid or inactive reservation allocation type: %', NEW.allocation_type
        USING ERRCODE = 'check_violation',
              HINT = 'Check inventory.reservation_types for valid allocation types';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS validate_reservation_allocation_type ON inventory.reservations;
CREATE TRIGGER validate_reservation_allocation_type
    BEFORE INSERT OR UPDATE OF allocation_type ON inventory.reservations
    FOR EACH ROW
    EXECUTE FUNCTION inventory.validate_reservation_allocation_type();
