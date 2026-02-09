-- ============================================================================
-- Option A Device Onboarding (Minimal API Surface)
-- ============================================================================
-- Purpose: Add claim/code/config tables and rpc_claim_device while reusing
--          inventory.rfid_devices. Also expands device status and fields.
-- Date: 2026-02-08
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Extend inventory.rfid_devices (canonical registry)
-- ---------------------------------------------------------------------------
ALTER TABLE inventory.rfid_devices
    ALTER COLUMN tenant_id DROP NOT NULL;

ALTER TABLE inventory.rfid_devices
    ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'handheld_scanner',
    ADD COLUMN IF NOT EXISTS name TEXT,
    ADD COLUMN IF NOT EXISTS fingerprint TEXT,
    ADD COLUMN IF NOT EXISTS device_secret_hash TEXT,
    ADD COLUMN IF NOT EXISTS capabilities JSONB,
    ADD COLUMN IF NOT EXISTS current_config_version INTEGER NOT NULL DEFAULT 0;

ALTER TABLE inventory.rfid_devices
    DROP CONSTRAINT IF EXISTS rfid_devices_status_check;

ALTER TABLE inventory.rfid_devices
    ADD CONSTRAINT rfid_devices_status_check
    CHECK (status IN ('unassigned', 'active', 'suspended', 'disabled', 'retired'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_rfid_devices_fingerprint_unique
    ON inventory.rfid_devices(fingerprint)
    WHERE fingerprint IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2) Device claim codes (ephemeral)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory.rfid_device_claim_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL REFERENCES inventory.rfid_devices(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    consumed_by_user_id UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT rfid_device_claim_codes_code_unique UNIQUE (code),
    CONSTRAINT rfid_device_claim_codes_code_length CHECK (char_length(code) >= 8)
);

CREATE INDEX IF NOT EXISTS idx_rfid_device_claim_codes_device
    ON inventory.rfid_device_claim_codes(device_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rfid_device_claim_codes_active
    ON inventory.rfid_device_claim_codes(device_id, expires_at DESC)
    WHERE consumed_at IS NULL;

ALTER TABLE inventory.rfid_device_claim_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY rfid_device_claim_codes_service_role
    ON inventory.rfid_device_claim_codes
    FOR ALL
    TO service_role
    USING (TRUE)
    WITH CHECK (TRUE);

-- ---------------------------------------------------------------------------
-- 3) Device claim audit trail
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory.rfid_device_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL REFERENCES inventory.rfid_devices(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,
    claimed_by_user_id UUID REFERENCES auth.users(id),
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    unclaimed_at TIMESTAMPTZ,
    reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_rfid_device_claims_device
    ON inventory.rfid_device_claims(device_id, claimed_at DESC);

CREATE INDEX IF NOT EXISTS idx_rfid_device_claims_tenant
    ON inventory.rfid_device_claims(tenant_id, claimed_at DESC);

ALTER TABLE inventory.rfid_device_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY rfid_device_claims_tenant_read
    ON inventory.rfid_device_claims
    FOR SELECT
    TO authenticated
    USING (tenant_id = current_tenant_id());

CREATE POLICY rfid_device_claims_service_role
    ON inventory.rfid_device_claims
    FOR ALL
    TO service_role
    USING (TRUE)
    WITH CHECK (TRUE);

-- ---------------------------------------------------------------------------
-- 4) Versioned device configs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory.rfid_device_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL REFERENCES inventory.rfid_devices(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    config JSONB NOT NULL,
    published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_by_user_id UUID REFERENCES auth.users(id),
    CONSTRAINT rfid_device_configs_device_version_unique UNIQUE (device_id, version)
);

CREATE INDEX IF NOT EXISTS idx_rfid_device_configs_device
    ON inventory.rfid_device_configs(device_id, version DESC);

ALTER TABLE inventory.rfid_device_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY rfid_device_configs_tenant_read
    ON inventory.rfid_device_configs
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM inventory.rfid_devices d
            WHERE d.id = device_id
              AND d.tenant_id = current_tenant_id()
        )
    );

CREATE POLICY rfid_device_configs_service_role
    ON inventory.rfid_device_configs
    FOR ALL
    TO service_role
    USING (TRUE)
    WITH CHECK (TRUE);

-- ---------------------------------------------------------------------------
-- 5) Realtime publication (devices + configs)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'inventory'
              AND tablename = 'rfid_devices'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE inventory.rfid_devices;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'inventory'
              AND tablename = 'rfid_device_configs'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE inventory.rfid_device_configs;
        END IF;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6) rpc_claim_device (Option A)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_claim_device(
    p_claim_code TEXT,
    p_device_name TEXT,
    p_role TEXT DEFAULT 'handheld_scanner',
    p_scope JSONB DEFAULT NULL,
    p_initial_config JSONB DEFAULT NULL
)
RETURNS TABLE (
    device_id UUID,
    tenant_id UUID,
    status TEXT,
    role TEXT,
    name TEXT,
    config_version INTEGER,
    config JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = inventory, public
AS $$
DECLARE
    v_tenant_id UUID;
    v_user_id UUID;
    v_code RECORD;
    v_device RECORD;
    v_config JSONB;
    v_version INTEGER;
    v_existing_config RECORD;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    v_tenant_id := current_tenant_id();
    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Tenant not found in session';
    END IF;

    SELECT * INTO v_code
    FROM inventory.rfid_device_claim_codes
    WHERE code = p_claim_code
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid claim code';
    END IF;

    IF v_code.expires_at <= NOW() THEN
        RAISE EXCEPTION 'Claim code expired';
    END IF;

    IF v_code.consumed_at IS NOT NULL THEN
        IF v_code.consumed_by_user_id = v_user_id THEN
            SELECT * INTO v_device
            FROM inventory.rfid_devices
            WHERE id = v_code.device_id;

            SELECT c.version, c.config INTO v_existing_config
            FROM inventory.rfid_device_configs c
            WHERE c.device_id = v_code.device_id
            ORDER BY c.version DESC
            LIMIT 1;

            RETURN QUERY
            SELECT v_device.id,
                   v_device.tenant_id,
                   v_device.status,
                   v_device.role,
                   v_device.name,
                   v_existing_config.version,
                   v_existing_config.config;
            RETURN;
        END IF;

        RAISE EXCEPTION 'Claim code already used';
    END IF;

    SELECT * INTO v_device
    FROM inventory.rfid_devices d
    WHERE d.id = v_code.device_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Device not found for claim code';
    END IF;

    IF v_device.tenant_id IS NOT NULL AND v_device.tenant_id <> v_tenant_id THEN
        RAISE EXCEPTION 'Device already claimed by another tenant';
    END IF;

    UPDATE inventory.rfid_device_claim_codes
    SET consumed_at = NOW(),
        consumed_by_user_id = v_user_id
    WHERE id = v_code.id;

    UPDATE inventory.rfid_devices
    SET tenant_id = v_tenant_id,
        status = 'active',
        role = COALESCE(p_role, role),
        name = COALESCE(p_device_name, name),
        updated_at = NOW()
    WHERE id = v_device.id;

    INSERT INTO inventory.rfid_device_claims (
        device_id,
        tenant_id,
        claimed_by_user_id,
        claimed_at,
        reason
    ) VALUES (
        v_device.id,
        v_tenant_id,
        v_user_id,
        NOW(),
        'claimed'
    );

    SELECT COALESCE(MAX(version), 0) + 1
      INTO v_version
      FROM inventory.rfid_device_configs
     WHERE device_id = v_device.id;

    v_config := jsonb_build_object(
        'role', COALESCE(p_role, 'handheld_scanner')
    );

    IF p_scope IS NOT NULL THEN
        v_config := v_config || jsonb_build_object('scope', p_scope);
    END IF;

    IF p_initial_config IS NOT NULL THEN
        v_config := v_config || p_initial_config;
    END IF;

    INSERT INTO inventory.rfid_device_configs (
        device_id,
        version,
        config,
        published_by_user_id
    ) VALUES (
        v_device.id,
        v_version,
        v_config,
        v_user_id
    );

    UPDATE inventory.rfid_devices
    SET current_config_version = v_version
    WHERE id = v_device.id;

    RETURN QUERY
    SELECT v_device.id,
           v_tenant_id,
           'active',
           COALESCE(p_role, 'handheld_scanner'),
           COALESCE(p_device_name, v_device.name),
           v_version,
           v_config;
END;
$$;

COMMENT ON FUNCTION public.rpc_claim_device IS
'Claims an unassigned RFID device via claim code, assigns tenant and initial config. Option A onboarding.';

-- ---------------------------------------------------------------------------
-- 7) Remove mismatched RFID RPCs (schema drift, unused)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.rfid_register_device(UUID, TEXT, TEXT, TEXT[], TEXT, UUID);
DROP FUNCTION IF EXISTS public.rfid_authenticate_device(UUID, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.rfid_device_heartbeat(UUID, UUID, TEXT, TEXT, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS public.rfid_device_sync_cycle_counts(UUID, UUID);
DROP FUNCTION IF EXISTS public.rfid_submit_cycle_count_results(UUID, UUID, UUID, UUID, JSONB, JSONB);
DROP FUNCTION IF EXISTS public.rfid_get_pending_submissions(UUID, UUID);
DROP FUNCTION IF EXISTS public.rfid_commit_submission(UUID, UUID, UUID);
DROP FUNCTION IF EXISTS public.rfid_capture_epc(UUID, TEXT, INTEGER, UUID);
DROP FUNCTION IF EXISTS public.rfid_assign_tag_to_asset(UUID, TEXT, UUID, UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.rfid_start_bulk_assignment_session(UUID, UUID, UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.rfid_add_tag_to_bulk_session(UUID, UUID, TEXT, UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.rfid_complete_bulk_assignment_session(UUID, UUID, UUID);
DROP FUNCTION IF EXISTS public.rfid_retire_tag(UUID, TEXT, UUID, TEXT);
