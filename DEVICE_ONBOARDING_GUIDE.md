# Device Onboarding and Claiming (Option A)

Date: 2026-02-09
Scope: Raspberry Pi device onboarding and configuration using Supabase Edge Function + RPC.

## 1) What exists in the DB

Canonical tables (inventory schema):
- inventory.rfid_devices: device registry (supports unclaimed devices)
- inventory.rfid_device_claim_codes: short-lived claim codes
- inventory.rfid_device_claims: claim audit trail
- inventory.rfid_device_configs: versioned device configs

Key API surface (minimal):
- Edge Function: device_announce
- RPC: public.rpc_claim_device

## 2) Claiming flow (end-to-end)

1) Device boots and calls device_announce with:
   - fingerprint (stable unique ID)
   - device_secret (required for unclaimed devices)
   - device_type, capabilities, firmware_version (optional)
2) Edge Function:
   - verifies authentication
     - if api_key_hash exists: require api_key
     - else require device_secret (stored as device_secret_hash)
   - upserts inventory.rfid_devices
   - if unclaimed: returns claim code (format XXXX-XXXX, TTL 120s)
3) Human user enters claim code in web UI
   - UI calls rpc_claim_device
   - rpc_claim_device consumes claim code, assigns tenant, sets status active, writes initial config
4) Device receives config
   - poll inventory.rfid_device_configs for latest version
   - or subscribe via Realtime (inventory.rfid_device_configs + inventory.rfid_devices)

## 3) Device auth rules

- Unclaimed device:
  - must send device_secret to device_announce
  - device_secret_hash stored on first announce
- Claimed device:
  - must send api_key if api_key_hash exists
  - otherwise must send device_secret (device_secret_hash required)

## 4) Device responsibilities (Raspberry Pi)

- Generate and persist a device_secret on first boot
- Derive and persist a stable fingerprint (CPU serial, MAC hash, or similar)
- Call device_announce on boot and periodically (heartbeat)
- Display claim_code if returned
- Poll or subscribe to config changes and apply them

## 5) Edge Function contract (device_announce)

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
  "expires_at": "timestamp (only when unassigned)"
}

## 6) RPC contract (rpc_claim_device)

RPC name: rpc_claim_device
Params:
- p_claim_code: text (XXXX-XXXX)
- p_device_name: text
- p_role: text (default: handheld_scanner)
- p_scope: jsonb (optional)
- p_initial_config: jsonb (optional)

Returns:
- device_id, tenant_id, status, role, name, config_version, config

## 7) Polling/Realtime strategy

- Poll device_announce every 30-60 seconds for last_seen_at updates and claim status
- If claimed, poll inventory.rfid_device_configs for latest version
- Alternatively, use Realtime subscriptions for inventory.rfid_device_configs and inventory.rfid_devices

## 8) Failure modes to handle

- device_announce returns 401: missing or invalid secret/api_key
- claim_code expired: request a new code (call device_announce again)
- rpc_claim_device failure: surface error, re-enter code
- config version unchanged: no action

---

# Prompt Template for Another AI (Device Programmer)

You are a senior embedded developer. Implement a Raspberry Pi service that onboards with Supabase using the Option A device flow described below.

Functional requirements:
- Generate and store a persistent device_secret on first boot.
- Derive a stable fingerprint (e.g., CPU serial or MAC hash) and store it.
- On boot, call device_announce (HTTP POST) with fingerprint + device_secret.
- If response includes claim_code, display it on the device screen.
- Poll device_announce every 30-60s until status becomes active and tenant_id is not null.
- Once claimed, fetch latest config from inventory.rfid_device_configs.
- If current_config_version changes, apply new config and persist config version.

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
  "expires_at": "timestamp (only when unassigned)"
}

Config retrieval (after claim):
- Query inventory.rfid_device_configs for device_id, order by version desc, limit 1.
- Apply config if version > current_config_version.

Non-functional:
- Handle network retries with backoff.
- Log errors locally.
- Do not leak device_secret.

Deliver:
- A minimal service script (Python or Node) and a short README on how to run it on Raspberry Pi.
