-- ============================================================================
-- Device Onboarding Hardening
-- ============================================================================
-- Purpose: Guard device_secret_hash overwrites and add claim code lookup index.
-- Date: 2026-02-09
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Prevent device_secret_hash overwrite after initial set
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inventory.guard_device_secret_hash_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = inventory, public
AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF OLD.device_secret_hash IS NOT NULL
           AND NEW.device_secret_hash IS DISTINCT FROM OLD.device_secret_hash
           AND auth.role() <> 'service_role' THEN
            RAISE EXCEPTION 'device_secret_hash cannot be overwritten once set';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_device_secret_hash_update ON inventory.rfid_devices;

CREATE TRIGGER guard_device_secret_hash_update
    BEFORE UPDATE ON inventory.rfid_devices
    FOR EACH ROW
    EXECUTE FUNCTION inventory.guard_device_secret_hash_update();

-- ---------------------------------------------------------------------------
-- 2) Claim code lookup index (reuse + expiration checks)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_rfid_device_claim_codes_device_consumed_expires
    ON inventory.rfid_device_claim_codes(device_id, consumed_at, expires_at);
