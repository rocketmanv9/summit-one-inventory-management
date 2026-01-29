# RFID API Quick Reference

**For Frontend Developers** - Quick copy/paste examples for all RFID endpoints

---

## 🔐 Device Authentication

### Register New Device (Admin Only)
```typescript
const { data } = await supabase.rpc('rfid_register_device', {
  p_tenant_id: tenantId,
  p_device_code: 'scanner-01',
  p_device_type: 'handheld_cycle_count',
  p_scopes: ['cycle_count:sync', 'cycle_count:submit', 'device:heartbeat'],
  p_notes: 'Warehouse A handheld scanner',
  p_registered_by: userId
});

// Returns: { device_id, api_key }
// ⚠️ Save api_key - never shown again!
```

### Authenticate Device
```typescript
const { data } = await supabase.rpc('rfid_authenticate_device', {
  p_tenant_id: tenantId,
  p_device_code: 'scanner-01',
  p_api_key: savedApiKey,
  p_required_scope: 'cycle_count:sync' // Optional
});

// Returns: { device_id, device_type, scopes, is_active, has_required_scope }
```

### Send Heartbeat
```typescript
const { data } = await supabase.rpc('rfid_device_heartbeat', {
  p_device_id: deviceId,
  p_tenant_id: tenantId,
  p_firmware_version: 'v2.1.0',
  p_app_version: 'v1.5.2',
  p_battery_level: 75,
  p_ip_address: '192.168.1.100'
});

// Returns: { success: true, heartbeat_at: "...", event_id: "..." }
```

---

## 📱 Handheld Cycle Count Workflow

### 1. Sync Cycle Count Requests
```typescript
const { data: cycleCounts } = await supabase.rpc('rfid_device_sync_cycle_counts', {
  p_device_id: deviceId,
  p_tenant_id: tenantId
});

// Returns array:
// [
//   {
//     cycle_count_id: "...",
//     cycle_count_number: "CC-2026-00042",
//     location_code: "WHSE-A-R5",
//     location_name: "Warehouse A - Row 5",
//     count_type: "full",
//     is_blind: false,
//     expected_sku_count: 15,
//     expected_asset_count: 8
//   },
//   ...
// ]
```

### 2. Submit Scan Results
```typescript
const { data } = await supabase.rpc('rfid_submit_cycle_count_results', {
  p_device_id: deviceId,
  p_tenant_id: tenantId,
  p_cycle_count_id: cycleCountId,
  p_client_submission_id: uuidv4(), // Generate unique ID for idempotency
  p_epc_list: [
    {
      epc: "3034257BF7194E4000003039",
      rssi: -45,
      count: 3,
      first_seen: "2026-01-28T10:15:22Z",
      last_seen: "2026-01-28T10:16:05Z"
    },
    {
      epc: "3034257BF7194E4000003040",
      rssi: -52,
      count: 1,
      first_seen: "2026-01-28T10:15:30Z",
      last_seen: "2026-01-28T10:15:30Z"
    }
  ],
  p_scan_metadata: {
    duration_seconds: 320,
    power_mode: "MED",
    started_at: "2026-01-28T10:15:00Z",
    ended_at: "2026-01-28T10:20:20Z"
  }
});

// Returns:
// {
//   submission_id: "...",
//   status: "uploaded", // or "duplicate" if already submitted
//   unique_epcs_count: 2,
//   total_reads: 4,
//   event_id: "..."
// }
```

---

## 🖥️ Desktop Review & Commit

### 3. Get Pending Submissions
```typescript
const { data: submissions } = await supabase.rpc('rfid_get_pending_submissions', {
  p_tenant_id: tenantId,
  p_cycle_count_id: null // Optional: filter by specific count
});

// Returns array:
// [
//   {
//     submission_id: "...",
//     cycle_count_id: "...",
//     cycle_count_number: "CC-2026-00042",
//     device_code: "scanner-01",
//     unique_epcs_count: 45,
//     total_reads: 287,
//     uploaded_at: "2026-01-28T10:20:25Z",
//     submission_status: "uploaded",
//     recognized_tags: null, // Set after commit
//     unrecognized_epcs: null
//   },
//   ...
// ]
```

### 4. Commit Submission to Inventory
```typescript
const { data } = await supabase.rpc('rfid_commit_submission', {
  p_submission_id: submissionId,
  p_tenant_id: tenantId,
  p_committed_by: userId
});

// Returns:
// {
//   success: true,
//   submission_id: "...",
//   recognized_tags: 42,
//   unrecognized_epcs: 3,
//   event_id: "..."
// }
```

---

## 🏷️ Individual Asset Tag Assignment

### 1. Capture EPC from USB Reader
```typescript
const { data } = await supabase.rpc('rfid_capture_epc', {
  p_tenant_id: tenantId,
  p_epc: '3034257BF7194E4000003039',
  p_rssi: -45,
  p_captured_by: userId
});

// Returns:
// {
//   capture_id: "...",
//   epc: "3034257BF7194E4000003039",
//   existing_tag_id: null, // or UUID if already assigned
//   existing_assignment: "unassigned" // or "asset" or "bulk_item"
// }
```

### 2. Assign Tag to Asset
```typescript
const { data } = await supabase.rpc('rfid_assign_tag_to_asset', {
  p_tenant_id: tenantId,
  p_epc: '3034257BF7194E4000003039',
  p_asset_id: assetId,
  p_assigned_by: userId,
  p_assigned_via_device_id: null, // Optional: device used for assignment
  p_notes: 'Forklift #42 - Toyota 8FGU25'
});

// Returns:
// {
//   tag_id: "...",
//   assignment_type: "new", // or "reassigned"
//   event_id: "..."
// }
```

---

## 📦 Bulk Tag Assignment (Pooled Tags)

### 1. Start Bulk Session
```typescript
const { data } = await supabase.rpc('rfid_start_bulk_assignment_session', {
  p_tenant_id: tenantId,
  p_catalog_item_id: catalogItemId,
  p_started_by: userId,
  p_notes: 'Tagging 100 units of rebar'
});

// Returns:
// {
//   session_id: "...",
//   session_number: "BULK-2026-00001"
// }
```

### 2. Add Tags to Session (Loop)
```typescript
const { data } = await supabase.rpc('rfid_add_tag_to_bulk_session', {
  p_session_id: sessionId,
  p_tenant_id: tenantId,
  p_epc: '3034257BF7194E4000003039',
  p_added_by: userId
});

// Returns:
// {
//   tag_id: "...",
//   tag_count_in_session: 1 // Increments with each tag
// }
```

### 3. Complete Session
```typescript
const { data } = await supabase.rpc('rfid_complete_bulk_assignment_session', {
  p_session_id: sessionId,
  p_tenant_id: tenantId,
  p_completed_by: userId
});

// Returns:
// {
//   session_id: "...",
//   tag_count: 100,
//   event_id: "..."
// }
```

---

## 🗑️ Tag Management

### Retire Tag
```typescript
const { data: eventId } = await supabase.rpc('rfid_retire_tag', {
  p_tag_id: tagId,
  p_tenant_id: tenantId,
  p_reason: 'Tag damaged - no longer readable',
  p_retired_by: userId
});

// Returns: event_id UUID
```

---

## 📊 Query Tag Data (Direct Table Access)

### Get Tag by EPC
```typescript
const { data: tag } = await supabase
  .from('rfid_tags')
  .select(`
    tag_id,
    epc,
    tag_category,
    tag_status,
    asset:assets (
      asset_code,
      description,
      location:locations (
        location_code,
        location_name
      )
    ),
    catalog_item:catalog_items (
      item_code,
      description
    )
  `)
  .eq('tenant_id', tenantId)
  .eq('epc', epcValue)
  .eq('tag_status', 'active')
  .single();
```

### Get All Tags for Asset
```typescript
const { data: tags } = await supabase
  .from('rfid_tags')
  .select('tag_id, epc, tag_status, created_at')
  .eq('tenant_id', tenantId)
  .eq('asset_id', assetId)
  .order('created_at', { ascending: false });
```

### Get Tag Assignment History
```typescript
const { data: history } = await supabase
  .from('rfid_tag_assignment_history')
  .select(`
    history_id,
    assignment_type,
    epc,
    asset:assets (asset_code, description),
    catalog_item:catalog_items (item_code),
    assigned_at,
    assigned_by:users (full_name),
    assignment_notes
  `)
  .eq('tenant_id', tenantId)
  .eq('tag_id', tagId)
  .order('assigned_at', { ascending: false });
```

---

## 🎯 Event Subscriptions (Real-time)

### Subscribe to Cycle Count Submissions
```typescript
const subscription = supabase
  .channel('rfid-submissions')
  .on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'inventory',
      table: 'rfid_cycle_count_submissions',
      filter: `tenant_id=eq.${tenantId}`
    },
    (payload) => {
      console.log('New submission uploaded:', payload.new);
    }
  )
  .subscribe();
```

### Subscribe to Tag Assignments
```typescript
const subscription = supabase
  .channel('rfid-tags')
  .on(
    'postgres_changes',
    {
      event: '*', // INSERT, UPDATE
      schema: 'inventory',
      table: 'rfid_tags',
      filter: `tenant_id=eq.${tenantId}`
    },
    (payload) => {
      console.log('Tag changed:', payload);
    }
  )
  .subscribe();
```

---

## 🔍 Common Queries

### Get Device Info
```typescript
const { data: device } = await supabase
  .from('rfid_devices')
  .select('device_id, device_code, device_type, is_active, last_heartbeat_at, battery_level')
  .eq('tenant_id', tenantId)
  .eq('device_code', deviceCode)
  .single();
```

### Get Unrecognized EPCs from Submission
```typescript
// After committing, check for unrecognized EPCs
const { data: submission } = await supabase
  .from('rfid_cycle_count_submissions')
  .select('epc_list, recognized_tags_count, unrecognized_epcs_count')
  .eq('submission_id', submissionId)
  .single();

// Filter EPCs not in rfid_tags
const allEpcs = submission.epc_list.map(item => item.epc);
const { data: recognizedTags } = await supabase
  .from('rfid_tags')
  .select('epc')
  .eq('tenant_id', tenantId)
  .in('epc', allEpcs);

const recognizedEpcs = new Set(recognizedTags.map(t => t.epc));
const unrecognizedEpcs = allEpcs.filter(epc => !recognizedEpcs.has(epc));

console.log('Unrecognized EPCs:', unrecognizedEpcs);
```

---

## ⚠️ Error Handling

### Common Errors

**Device Authentication Failed:**
```typescript
// Error: "Invalid device credentials"
// Solution: Verify tenant_id, device_code, and api_key are correct
```

**Tag Already Assigned:**
```typescript
// When assigning tag that's already assigned, function still succeeds
// Returns assignment_type = 'reassigned'
// Check existing_assignment from rfid_capture_epc() to warn user
```

**Duplicate Submission:**
```typescript
// Returns status = 'duplicate' instead of 'uploaded'
// Safe to retry with same client_submission_id
```

**Session Not In Progress:**
```typescript
// Error: "Session is not in progress (status=completed)"
// Solution: Start new session before adding tags
```

---

## 📝 TypeScript Types

```typescript
interface RfidDevice {
  device_id: string;
  tenant_id: string;
  device_code: string;
  device_type: 'handheld_cycle_count' | 'handheld_assignment' | 'portal_reader';
  scopes: string[];
  is_active: boolean;
  last_heartbeat_at: string | null;
  battery_level: number | null;
}

interface RfidTag {
  tag_id: string;
  tenant_id: string;
  epc: string;
  tag_category: 'asset_tag' | 'bulk_item_tag';
  asset_id: string | null;
  bulk_catalog_item_id: string | null;
  current_location_id: string | null;
  tag_status: 'active' | 'retired' | 'lost';
}

interface CycleCountSubmission {
  submission_id: string;
  tenant_id: string;
  device_id: string;
  cycle_count_id: string;
  client_submission_id: string;
  epc_list: EpcRead[];
  scan_metadata: ScanMetadata;
  submission_status: 'uploaded' | 'reviewed' | 'committed';
  recognized_tags_count: number | null;
  unrecognized_epcs_count: number | null;
}

interface EpcRead {
  epc: string;
  rssi: number;
  count: number;
  first_seen: string;
  last_seen: string;
}

interface ScanMetadata {
  duration_seconds: number;
  power_mode: 'LOW' | 'MED' | 'HIGH';
  started_at: string;
  ended_at: string;
}
```

---

## 🚀 Complete Workflow Examples

### Handheld App: Full Cycle Count Flow
```typescript
// 1. Authenticate on app startup
const auth = await supabase.rpc('rfid_authenticate_device', {
  p_tenant_id: config.tenantId,
  p_device_code: config.deviceCode,
  p_api_key: config.apiKey,
  p_required_scope: 'cycle_count:sync'
});

if (!auth.data.is_active) {
  throw new Error('Device is deactivated');
}

// 2. Send heartbeat periodically (every 5 minutes)
setInterval(async () => {
  await supabase.rpc('rfid_device_heartbeat', {
    p_device_id: auth.data.device_id,
    p_tenant_id: config.tenantId,
    p_battery_level: await getBatteryLevel(),
    p_app_version: APP_VERSION
  });
}, 5 * 60 * 1000);

// 3. Sync cycle counts when online
const { data: cycleCounts } = await supabase.rpc('rfid_device_sync_cycle_counts', {
  p_device_id: auth.data.device_id,
  p_tenant_id: config.tenantId
});

// Store locally
await localDB.cycleCounts.bulkPut(cycleCounts);

// 4. User selects count and scans (offline)
const epcList = await rfidScanner.scan({ durationSeconds: 60, powerMode: 'MED' });

// Store locally
await localDB.submissions.add({
  client_submission_id: uuidv4(),
  cycle_count_id: selectedCount.cycle_count_id,
  epc_list: epcList,
  scan_metadata: { duration_seconds: 60, power_mode: 'MED', ... }
});

// 5. Upload when online
const pendingSubmissions = await localDB.submissions.where('uploaded').equals(false).toArray();

for (const sub of pendingSubmissions) {
  const result = await supabase.rpc('rfid_submit_cycle_count_results', {
    p_device_id: auth.data.device_id,
    p_tenant_id: config.tenantId,
    p_cycle_count_id: sub.cycle_count_id,
    p_client_submission_id: sub.client_submission_id,
    p_epc_list: sub.epc_list,
    p_scan_metadata: sub.scan_metadata
  });
  
  if (result.data.status !== 'duplicate') {
    await localDB.submissions.update(sub.id, { uploaded: true });
  }
}
```

---

**Need Help?** See full documentation in `RFID_INFRASTRUCTURE_IMPLEMENTATION_SUMMARY.md`
