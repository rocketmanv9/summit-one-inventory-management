# RFID System API Reference

## Overview
Complete API reference for the RFID infrastructure in Summit Inventory Management. All endpoints require authentication via tenant headers.

## Base URL
```
/api/inventory/rfid
```

## Authentication
All requests must include tenant authentication headers:
```
x-tenant-id: <tenant-uuid>
x-user-id: <user-uuid>
```

---

## Device Management

### Register RFID Device
Register a new RFID device and obtain API credentials.

**Endpoint:** `POST /api/inventory/rfid/devices`

**Request Body:**
```json
{
  "device_code": "HANDHELD-001",
  "device_type": "handheld_cycle_count",
  "scopes": ["cycle_count:sync", "cycle_count:submit", "device:heartbeat"],
  "notes": "Primary warehouse handheld scanner"
}
```

**Device Types:**
- `handheld_cycle_count` - Mobile device for cycle counting
- `handheld_assignment` - Mobile device for tag assignment
- `portal_reader` - Fixed portal reader for movement tracking

**Scopes:**
- `cycle_count:sync` - Download cycle counts to device
- `cycle_count:submit` - Upload cycle count results
- `tag:assign` - Assign tags to assets
- `tag:capture` - Capture EPC scans
- `device:heartbeat` - Send heartbeat signals

**Response:**
```json
{
  "data": {
    "device_id": "uuid",
    "api_key": "64-char-hex-string"
  },
  "message": "RFID device registered successfully. Save the API key securely - it will not be shown again."
}
```

⚠️ **Important:** The `api_key` is only returned once during registration. Store it securely.

---

### List RFID Devices
Get all registered RFID devices for the tenant.

**Endpoint:** `GET /api/inventory/rfid/devices`

**Response:**
```json
{
  "data": [
    {
      "device_id": "uuid",
      "tenant_id": "uuid",
      "device_code": "HANDHELD-001",
      "device_type": "handheld_cycle_count",
      "scopes": ["cycle_count:sync", "cycle_count:submit"],
      "status": "active",
      "last_heartbeat_at": "2026-01-28T10:30:00Z",
      "battery_level": 85,
      "created_at": "2026-01-28T08:00:00Z"
    }
  ],
  "meta": {
    "count": 1
  }
}
```

---

### Authenticate Device
Authenticate an RFID device using device code and API key.

**Endpoint:** `POST /api/inventory/rfid/devices/authenticate`

**Request Body:**
```json
{
  "device_code": "HANDHELD-001",
  "api_key": "64-char-hex-string"
}
```

**Response:**
```json
{
  "data": {
    "device_id": "uuid",
    "tenant_id": "uuid",
    "device_code": "HANDHELD-001",
    "scopes": ["cycle_count:sync", "cycle_count:submit"],
    "authenticated": true
  },
  "message": "Device authenticated successfully"
}
```

---

### Record Device Heartbeat
Record device status and health metrics.

**Endpoint:** `POST /api/inventory/rfid/devices/heartbeat`

**Request Body:**
```json
{
  "device_id": "uuid",
  "battery_level": 85,
  "signal_strength": -45
}
```

**Response:**
```json
{
  "data": {
    "device_id": "uuid",
    "last_heartbeat_at": "2026-01-28T10:30:00Z"
  },
  "message": "Heartbeat recorded"
}
```

---

### Sync Cycle Counts to Device
Download pending cycle counts for a device to execute.

**Endpoint:** `POST /api/inventory/rfid/devices/sync`

**Request Body:**
```json
{
  "device_id": "uuid"
}
```

**Response:**
```json
{
  "data": [
    {
      "cycle_count_id": "uuid",
      "count_number": "CC-2026-001",
      "location_id": "uuid",
      "location_name": "Warehouse A - Zone 1",
      "count_type": "full",
      "is_blind": false,
      "scheduled_for": "2026-01-28",
      "status": "in_progress"
    }
  ],
  "message": "Cycle counts synced successfully"
}
```

---

## Tag Management

### Capture EPC Scan
Record an RFID tag scan.

**Endpoint:** `POST /api/inventory/rfid/tags/capture`

**Request Body:**
```json
{
  "epc_hex": "E28011700000020123456789",
  "device_id": "uuid",
  "rssi": -45,
  "location_id": "uuid",
  "notes": "Scanned during cycle count"
}
```

**Response:**
```json
{
  "data": {
    "capture_id": "uuid",
    "epc_hex": "E28011700000020123456789",
    "captured_at": "2026-01-28T10:30:15Z",
    "tag_exists": true,
    "asset_id": "uuid"
  },
  "message": "EPC captured successfully"
}
```

---

### List RFID Tags
Get all RFID tags for the tenant.

**Endpoint:** `GET /api/inventory/rfid/tags`

**Query Parameters:**
- `status` - Filter by tag status (active, retired)
- `asset_id` - Filter by assigned asset

**Response:**
```json
{
  "data": [
    {
      "tag_id": "uuid",
      "epc_hex": "E28011700000020123456789",
      "status": "active",
      "asset_id": "uuid",
      "asset": {
        "id": "uuid",
        "asset_number": "AST-001",
        "catalog_item": {
          "name": "Excavator - CAT 320"
        }
      },
      "assigned_at": "2026-01-28T08:00:00Z",
      "created_at": "2026-01-28T08:00:00Z"
    }
  ],
  "meta": {
    "count": 1
  }
}
```

---

### Assign Tag to Asset
Assign an RFID tag to a specific asset.

**Endpoint:** `POST /api/inventory/rfid/tags/assign`

**Request Body:**
```json
{
  "epc_hex": "E28011700000020123456789",
  "asset_id": "uuid",
  "assignment_method": "manual"
}
```

**Assignment Methods:**
- `manual` - Manual assignment via UI
- `handheld_scan` - Assigned via handheld device
- `bulk_manual` - Bulk assignment session
- `automated_portal` - Automated via portal reader

**Response:**
```json
{
  "data": {
    "tag_id": "uuid",
    "asset_id": "uuid",
    "epc_hex": "E28011700000020123456789",
    "assignment_method": "manual",
    "assigned_at": "2026-01-28T10:30:00Z"
  },
  "message": "Tag assigned to asset successfully"
}
```

---

## Bulk Assignment

### Start Bulk Assignment Session
Begin a bulk tag assignment session.

**Endpoint:** `POST /api/inventory/rfid/bulk-assignment/start`

**Request Body:**
```json
{
  "location_id": "uuid",
  "assignment_method": "bulk_manual",
  "notes": "Tagging new equipment batch"
}
```

**Response:**
```json
{
  "data": {
    "session_id": "uuid",
    "location_id": "uuid",
    "status": "active",
    "started_at": "2026-01-28T10:30:00Z"
  },
  "message": "Bulk assignment session started"
}
```

---

### Add Tag to Bulk Session
Add a tag assignment to an active bulk session.

**Endpoint:** `POST /api/inventory/rfid/bulk-assignment/[session_id]/add-tag`

**Request Body:**
```json
{
  "epc_hex": "E28011700000020123456789",
  "asset_id": "uuid"
}
```

**Response:**
```json
{
  "data": {
    "tag_id": "uuid",
    "session_id": "uuid",
    "epc_hex": "E28011700000020123456789",
    "asset_id": "uuid"
  },
  "message": "Tag added to bulk assignment session"
}
```

---

### Complete Bulk Assignment Session
Finalize a bulk assignment session.

**Endpoint:** `POST /api/inventory/rfid/bulk-assignment/[session_id]/complete`

**Response:**
```json
{
  "data": {
    "session_id": "uuid",
    "status": "completed",
    "total_tags_assigned": 25,
    "completed_at": "2026-01-28T11:00:00Z"
  },
  "message": "Bulk assignment session completed successfully"
}
```

---

## Cycle Count Submissions

### Submit Cycle Count Results
Submit RFID scan results for a cycle count.

**Endpoint:** `POST /api/inventory/rfid/cycle-counts/submit`

**Request Body:**
```json
{
  "device_id": "uuid",
  "cycle_count_id": "uuid",
  "epc_list": [
    "E28011700000020123456789",
    "E28011700000020123456790",
    "E28011700000020123456791"
  ],
  "scan_metadata": {
    "total_reads": 150,
    "unique_tags": 3,
    "scan_duration_seconds": 45,
    "scan_started_at": "2026-01-28T10:30:00Z",
    "scan_completed_at": "2026-01-28T10:30:45Z"
  }
}
```

**Response:**
```json
{
  "data": {
    "submission_id": "uuid",
    "cycle_count_id": "uuid",
    "total_epcs_submitted": 3,
    "matched_assets": 3,
    "unmatched_epcs": 0,
    "submitted_at": "2026-01-28T10:31:00Z"
  },
  "message": "Cycle count results submitted successfully"
}
```

---

## Error Responses

All endpoints return consistent error responses:

**400 Bad Request:**
```json
{
  "error": "device_code, device_type, and scopes are required"
}
```

**401 Unauthorized:**
```json
{
  "error": "Not authenticated"
}
```

**404 Not Found:**
```json
{
  "error": "Device not found"
}
```

**500 Internal Server Error:**
```json
{
  "error": "Failed to register RFID device",
  "details": { "code": "23505", "message": "duplicate key value" }
}
```

---

## Integration Examples

### Mobile App - Cycle Count Workflow

```typescript
// 1. Authenticate device
const authResponse = await fetch('/api/inventory/rfid/devices/authenticate', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-tenant-id': tenantId,
    'x-user-id': userId
  },
  body: JSON.stringify({
    device_code: 'HANDHELD-001',
    api_key: storedApiKey
  })
});

const { data: device } = await authResponse.json();

// 2. Sync cycle counts
const syncResponse = await fetch('/api/inventory/rfid/devices/sync', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-tenant-id': tenantId,
    'x-user-id': userId
  },
  body: JSON.stringify({ device_id: device.device_id })
});

const { data: cycleCounts } = await syncResponse.json();

// 3. Perform RFID scan
const scannedEPCs = await performRFIDScan(); // Device-specific scanning

// 4. Submit results
const submitResponse = await fetch('/api/inventory/rfid/cycle-counts/submit', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-tenant-id': tenantId,
    'x-user-id': userId
  },
  body: JSON.stringify({
    device_id: device.device_id,
    cycle_count_id: cycleCounts[0].cycle_count_id,
    epc_list: scannedEPCs,
    scan_metadata: {
      total_reads: scannedEPCs.length,
      unique_tags: new Set(scannedEPCs).size,
      scan_duration_seconds: 45
    }
  })
});

// 5. Send heartbeat
await fetch('/api/inventory/rfid/devices/heartbeat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-tenant-id': tenantId,
    'x-user-id': userId
  },
  body: JSON.stringify({
    device_id: device.device_id,
    battery_level: await getBatteryLevel(),
    signal_strength: await getSignalStrength()
  })
});
```

---

## Database Functions Reference

All API routes call underlying PostgreSQL RPC functions:

| API Endpoint | RPC Function |
|-------------|--------------|
| `POST /devices` | `rfid_register_device()` |
| `POST /devices/authenticate` | `rfid_authenticate_device()` |
| `POST /devices/heartbeat` | `rfid_device_heartbeat()` |
| `POST /devices/sync` | `rfid_device_sync_cycle_counts()` |
| `POST /tags/capture` | `rfid_capture_epc()` |
| `POST /tags/assign` | `rfid_assign_tag_to_asset()` |
| `POST /bulk-assignment/start` | `rfid_start_bulk_assignment_session()` |
| `POST /bulk-assignment/.../add-tag` | `rfid_add_tag_to_bulk_session()` |
| `POST /bulk-assignment/.../complete` | `rfid_complete_bulk_assignment_session()` |
| `POST /cycle-counts/submit` | `rfid_submit_cycle_count_results()` |

---

## Security Notes

1. **API Keys:** Device API keys are hashed with bcrypt (cost factor 10) and never stored in plaintext
2. **Scope Validation:** All device operations validate scopes against registered device capabilities
3. **Tenant Isolation:** All operations enforce Row-Level Security (RLS) by tenant_id
4. **Authentication:** Device authentication requires both device_code and api_key
5. **Audit Trail:** All tag assignments and cycle count submissions are logged with timestamps and user IDs

---

## Next Steps

- Build React Native/Flutter mobile app using these endpoints
- Implement Web Serial API integration for desktop USB readers
- Create admin UI for device management
- Set up real-time WebSocket updates for portal readers
