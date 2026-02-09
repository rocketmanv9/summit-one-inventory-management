# Device Onboarding and Claiming (Option A, Revised)

Date: 2026-02-09
Scope: Raspberry Pi device onboarding + configuration using one Edge Function and one RPC.

## 1) Overview (what exists and what must exist)

Canonical tables (inventory schema):
- inventory.rfid_devices
- inventory.rfid_device_claim_codes
- inventory.rfid_device_claims
- inventory.rfid_device_configs

Only API surface:
- Edge Function: device_announce
- RPC: public.rpc_claim_device

No additional endpoints are required for v1.

## 2) Revised Claiming Flow (end-to-end)

1) Device boots and calls device_announce with:
   - fingerprint (stable unique ID)
   - device_secret (required for unclaimed devices)
   - device_type, capabilities, firmware_version (optional)
2) device_announce performs:
   - Authentication checks (see Section 3)
   - Upsert into inventory.rfid_devices
   - If unclaimed: returns a claim code bound to that device
3) Human user enters claim code in web UI
   - UI calls rpc_claim_device
   - rpc_claim_device consumes the code atomically, assigns tenant, sets status active, writes initial config
4) Device receives latest_config in device_announce response when active
  - If latest_config.version > device.current_config_version, apply and update
  - Otherwise, no change

## 3) Claim code binding and safety

Claim codes are bound to a single device (device_id).

Requirements:
- Single-use
- Time-limited
- Consumed atomically

Behavior:
- If a code expires: device_announce must generate a new code.
- If a code is reused: rpc_claim_device must reject with a clear error.
- If a mismatched device attempts to claim: rpc_claim_device must reject (code only valid for its device_id).

Implementation note:
- The claim code table must store device_id and enforce unique(code).
- rpc_claim_device must SELECT ... FOR UPDATE the code row, validate status and expiration, then consume.

## 4) Device authentication rules (hardened)

Unclaimed device:
- Must provide device_secret to device_announce.
- device_secret_hash is stored on first successful announce.
- device_secret is never overwritten after first registration.

Claimed device:
- Preferred auth: api_key (tenant-scoped) if api_key_hash exists.
- If api_key_hash does not exist, device_secret remains valid.
- If api_key_hash exists, device_secret should be rejected to prevent bypass.

Reclaim / reset / reassignment:
- Reclaim: allowed only after explicit admin action (not part of v1). Documented as a future admin workflow.
- Reset: clear tenant_id, set status to unassigned, rotate or clear api_key_hash, keep device_secret_hash.
- Reassign: same as reset then claim again with a new code.

## 5) Fingerprinting standard (Raspberry Pi)

Canonical fingerprint strategy:
- Use the Raspberry Pi CPU serial from /proc/cpuinfo (Serial field).
- If missing, fallback to MAC address hash (primary network interface).
- Persist fingerprint locally and reuse it on every boot.

Stability requirements:
- Must remain stable across reboots, software updates, power loss.
- If fingerprint derivation fails, device should not attempt to register; surface error locally.

## 6) Config delivery and versioning

Device row contains current_config_version (integer).

Rules:
- If no config exists: device should keep running in safe default mode.
- If latest config version equals current_config_version: no action.
- If latest config is invalid JSON: ignore and log; do not update current_config_version.

Device behavior:
- Use latest_config from device_announce response when status is active.
- When applied successfully, update device row current_config_version.

## 7) Failure and abuse handling

Repeated failed auth:
- device_announce must return 401; device should back off with exponential delay.

Rapid claim-code regeneration:
- Rate-limit by reusing an existing unexpired code for the same device_id.

Devices stuck unassigned:
- Continue showing claim code and allow re-claim.
- Device should re-announce periodically to keep last_seen_at updated.

Suspended or disabled devices:
- device_announce must return 403 with status information.
- Device should stop normal operation and display a blocked status.

---

# Edge Function Contract (device_announce)

Request JSON:
{
  "device_id": "optional-uuid",
  "fingerprint": "stable-unique-id",
  "device_secret": "string",
  "api_key": "string (only if api_key_hash present)",
  "device_type": "handheld_cycle_count | portal_reader | desktop_capture",
  "firmware_version": "optional",
  "capabilities": { "optional": true }
}

Response JSON:
{
  "device_id": "uuid",
  "status": "unassigned | active | suspended | disabled | retired",
  "tenant_id": "uuid or null",
  "claim_code": "XXXX-XXXX (only when unassigned)",
  "expires_at": "timestamp (only when unassigned)",
  "latest_config": {
    "version": 1,
    "config": { "example": true }
  }
}

Behavior notes:
- If device is suspended/disabled, return 403 with status.
- latest_config is only returned when status is active.
- device_secret must not be overwritten after first registration.

---

# RPC Contract (rpc_claim_device)

RPC name: rpc_claim_device
Params:
- p_claim_code: text (XXXX-XXXX)
- p_device_name: text
- p_role: text (default: handheld_scanner)
- p_scope: jsonb (optional)
- p_initial_config: jsonb (optional)

Returns:
- device_id, tenant_id, status, role, name, config_version, config

Rules:
- Must validate tenant_id from current session (no arbitrary tenant_id input).
- Must bind claim code to device_id and consume atomically.
- Must return same result if claim code already consumed by same user in same session (idempotent).

---

# Database Alignment Checklist

## inventory.rfid_devices
Existing: OK
- Required columns: id, tenant_id (nullable), device_code, device_type, status, api_key_hash, device_secret_hash, role, name, fingerprint, capabilities, current_config_version, last_seen_at, last_ip_address
- Constraints:
  - status enum includes unassigned, active, suspended, disabled, retired
  - unique fingerprint (nullable)
- Indexes:
  - tenant_id, status, last_seen_at
  - unique fingerprint (where not null)
- RLS:
  - tenant users can read only their tenant devices
  - service_role can read/write all

Needs change:
- Add a guard to prevent device_secret_hash overwrites after initial set (trigger or update policy). Reason: avoid secret replacement by attackers.
- Add status-based rejection in device_announce (app logic). Reason: stop suspended/disabled devices.

## inventory.rfid_device_claim_codes
Existing: OK
- Required columns: id, device_id, code, expires_at, consumed_at, consumed_by_user_id, created_at
- Constraints:
  - unique(code)
  - char_length(code) >= 8
- Indexes:
  - device_id + created_at desc
  - active codes (consumed_at is null)
- RLS:
  - service_role only; no tenant user access

Needs change:
- Add device_id + consumed_at + expires_at composite index. Reason: fast lookup for reuse and expiration.

## inventory.rfid_device_claims
Existing: OK
- Required columns: id, device_id, tenant_id, claimed_by_user_id, claimed_at, unclaimed_at, reason
- Indexes:
  - device_id + claimed_at desc
  - tenant_id + claimed_at desc
- RLS:
  - tenant users can read their tenant
  - service_role full access

Needs change:
- None for v1.

## inventory.rfid_device_configs
Existing: OK
- Required columns: id, device_id, version, config, published_at, published_by_user_id
- Constraints:
  - unique(device_id, version)
- Indexes:
  - device_id + version desc
- RLS:
  - tenant users read configs for devices in their tenant
  - service_role full access

Needs change:
- Consider NOT NULL for published_at (already default). No change required.

---

# Open Questions / Decisions

- Should api_key be mandatory post-claim for all devices, or optional if device_secret is sufficient?
- Do we need a formal admin-only reset endpoint now, or leave it as a manual DB action for v1?
- Should device_announce rate-limit per device_id (server-side) in addition to client backoff?

---

# Prompt Template for Another AI (Device Programmer)

You are a senior embedded developer. Implement a Raspberry Pi service that onboards with Supabase using the revised Option A flow described below.

Functional requirements:
- Generate and store a persistent device_secret on first boot (never rotate without factory reset).
- Derive a stable fingerprint from /proc/cpuinfo Serial. If missing, fallback to MAC hash. Persist it.
- On boot, call device_announce (HTTP POST) with fingerprint + device_secret.
- If response includes claim_code, display it on the device screen.
- Poll device_announce every 30-60s until status becomes active and tenant_id is not null.
- When active, use latest_config from the device_announce response.
- If latest_config.version > current_config_version, apply config and update current_config_version.
- If device is suspended/disabled, display blocked status and stop normal operation.

API endpoints:
- Edge Function: device_announce (HTTP POST)
- RPC: rpc_claim_device (used by web UI only, not the device)

device_announce request JSON:
{
  "fingerprint": "stable-unique-id",
  "device_secret": "string",
  "device_type": "handheld_cycle_count | portal_reader | desktop_capture",
  "firmware_version": "optional",
  "capabilities": { "optional": true }
}

device_announce response JSON:
{
  "device_id": "uuid",
  "status": "unassigned | active | suspended | disabled | retired",
  "tenant_id": "uuid or null",
  "claim_code": "XXXX-XXXX (only when unassigned)",
  "expires_at": "timestamp (only when unassigned)",
  "latest_config": {
    "version": 1,
    "config": { "example": true }
  }
}

Config retrieval:
- Use latest_config from device_announce when status is active.
- Apply config only if version > current_config_version and JSON is valid.

Non-functional:
- Handle network retries with exponential backoff.
- Log auth failures locally.
- Never log device_secret.

Deliver:
- A minimal service script (Python or Node) and a short README on how to run it on Raspberry Pi.
