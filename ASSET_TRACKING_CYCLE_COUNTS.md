# Asset-Level Tracking for Cycle Counts

## Overview
Implemented asset-level tracking for serialized items in cycle counts, allowing users to check which specific assets (e.g., Grinder G-1, Grinder G-2) were found during physical counts rather than just entering quantities.

## Database Schema

### `inventory.cycle_count_assets` Table
```sql
CREATE TABLE inventory.cycle_count_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  cycle_count_line_id UUID NOT NULL REFERENCES inventory.cycle_count_lines(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES inventory.assets(id),
  was_expected BOOLEAN NOT NULL DEFAULT false,
  was_found BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Fields**:
- `cycle_count_line_id`: Links to the cycle count line
- `asset_id`: Specific asset that was counted
- `was_expected`: TRUE if asset should have been at this location based on asset.location_id
- `was_found`: TRUE if asset was physically found (always true when record created)

**Indexes**:
- `idx_cycle_count_assets_tenant` on tenant_id
- `idx_cycle_count_assets_line` on cycle_count_line_id
- `idx_cycle_count_assets_asset` on asset_id
- `idx_cycle_count_assets_found` on was_found

## API Endpoints

### GET `/api/inventory/cycle-counts/[id]/lines/[line_id]/assets`
Fetches expected and counted assets for a cycle count line.

**Response**:
```json
{
  "expected_assets": [
    {
      "id": "asset-uuid",
      "name": "Bomag Grinder",
      "serial_number": "G-1",
      "status": "active",
      "location_id": "location-uuid"
    }
  ],
  "counted_assets": [
    {
      "id": "cca-uuid",
      "asset_id": "asset-uuid",
      "was_expected": true,
      "was_found": true
    }
  ]
}
```

### POST `/api/inventory/cycle-counts/[id]/lines/[line_id]/assets`
Records which assets were found during counting.

**Request**:
```json
{
  "asset_ids": ["asset-uuid-1", "asset-uuid-2"]
}
```

**Behavior**:
1. Deletes existing cycle_count_assets for this line
2. Inserts new records for each asset_id
3. Sets `was_expected = true` if asset.location_id matches count location
4. Updates `cycle_count_lines.qty_counted` to match asset count

## UI Implementation

### Tracking Mode Detection
The UI now checks `catalog_item.tracking_mode`:
- **`fungible`**: Shows quantity input (existing behavior)
- **`serialized`**: Shows asset checkboxes (new behavior)

### Asset Checkboxes (In Progress Status)
When a cycle count line has `tracking_mode = 'serialized'`:

```tsx
{line.expected_assets.map((asset) => (
  <label key={asset.id}>
    <input
      type="checkbox"
      checked={isChecked}
      onChange={(e) => {
        const newAssetIds = e.target.checked
          ? [...currentAssetIds, asset.id]
          : currentAssetIds.filter(id => id !== asset.id);
        updateAssetCount(line.id, newAssetIds);
      }}
    />
    {asset.serial_number || asset.name}
    <span>({asset.status})</span>
  </label>
))}
```

**Features**:
- Shows all assets expected at the count location
- User checks assets they physically found
- Auto-updates `qty_counted` to match checked count
- Displays "Found: X / Expected: Y" summary

### Variance Review (Under Review Status)
When reviewing variances for serialized items:

```tsx
{line.expected_assets.map((asset) => {
  const wasCounted = line.counted_assets?.some(ca => ca.asset_id === asset.id);
  return (
    <div className={wasCounted ? 'text-green-600' : 'text-red-600'}>
      <span>{wasCounted ? '✓' : '✗'}</span>
      <span>{asset.serial_number || asset.name}</span>
      <span>({wasCounted ? 'Found' : 'Missing'})</span>
    </div>
  );
})}
```

**Shows**:
- ✓ Grinder G-1 (Found)
- ✗ Grinder G-2 (Missing)

This makes it clear WHICH assets are missing, not just the quantity difference.

## Data Flow

### 1. Start Count
- User creates cycle count for a location
- Clicks "Start Count"
- `fetchCountLines()` loads:
  - Cycle count lines with `catalog_item.tracking_mode`
  - For serialized items: calls `/assets` endpoint to load `expected_assets` and `counted_assets`

### 2. Perform Count (In Progress)
**Fungible Items** (shovels, nuts, bolts):
- User enters quantity in number input
- Calls `updateCountLine(lineId, qty)` to update `qty_counted`

**Serialized Items** (grinders, equipment):
- User sees checkboxes for each asset at location
- User checks which assets they found (e.g., check G-1, uncheck G-2)
- Calls `updateAssetCount(lineId, assetIds)` which:
  - POSTs to `/assets` endpoint
  - Creates `cycle_count_assets` records
  - Auto-updates `qty_counted` to match asset count

### 3. Submit for Review
- User clicks "Submit for Review"
- Status changes to `under_review`
- Variance calculated: `qty_counted - qty_expected`
- For serialized items: Variance = (# assets found) - (# assets expected)

### 4. Variance Decision
- Reviewer sees which specific assets are missing
- Selects decision for each line:
  - **Accept**: Choose reason (loss/theft, transfer not recorded, etc.)
  - **Investigate**: Mark for further investigation
  - **Reject**: Recount required

### 5. Approve Count
- Calls `/approve` endpoint
- For each accepted variance:
  - Creates `stock_movements` with adjustment reason
  - Updates `stock_balances.qty_on_hand`
  - Emits `inventory.stock.adjusted` event
  - Checks reorder points
- For serialized items with accepted variances:
  - Future: Could update `asset.location_id` to null if asset missing
  - Future: Could mark asset as lost/stolen

## Example Scenarios

### Scenario 1: Missing Grinder
**Setup**:
- Location: Auburn Yard
- Expected: Grinder G-1 and G-2 at Auburn Yard
- Catalog Item: "Bomag Grinder" (tracking_mode = serialized)

**Count Process**:
1. Start count → sees checkboxes for G-1 and G-2
2. User finds only G-1, checks that box
3. Submit for review → Variance: -1 (expected 2, found 1)
4. Review shows:
   - ✓ Grinder G-1 (Found)
   - ✗ Grinder G-2 (Missing)
5. Accept with reason "loss_theft"
6. Approve → stock_balances updated from 2 to 1

### Scenario 2: All Assets Found
**Setup**:
- Expected: 1 grinder (G-1)
- User finds G-1

**Count Process**:
1. Check G-1 checkbox
2. Submit → No variance (expected 1, found 1)
3. Approve → No stock adjustment needed

## Future Enhancements

### Asset Location Updates
When accepting variance for missing serialized asset:
```sql
UPDATE inventory.assets
SET location_id = NULL,
    status = 'lost'
WHERE id = 'missing-asset-id';
```

### Per-Asset Variance Decisions
Allow different decisions for different assets:
- Accept G-2 missing (loss/theft)
- Investigate G-3 missing (might be transferred)

### Asset Transfer Detection
If asset found at wrong location during count:
- Show "Unexpected asset found: G-5"
- Suggest transfer from actual location

### Blind Counts for Serialized
Instead of showing checkboxes with asset names:
- Show "Scan asset tags" input
- User scans barcodes/QR codes
- System matches to expected assets after submission

## Migration Applied
- File: `supabase/migrations/20260129000004_cycle_count_asset_tracking.sql`
- Status: ✅ Applied successfully
- Created: `cycle_count_assets` table with RLS, indexes, and comments

## Testing Checklist

- [ ] Create cycle count at location with serialized items
- [ ] Start count and verify asset checkboxes appear
- [ ] Check/uncheck assets and verify `qty_counted` updates
- [ ] Submit with variance (missing asset) and verify count shown
- [ ] Verify variance review shows which assets missing
- [ ] Accept variance with reason and approve
- [ ] Verify `stock_balances` updated correctly
- [ ] Verify `cycle_count_assets` records created
- [ ] Test blind count with serialized items
- [ ] Test mixed count (both fungible and serialized items)
