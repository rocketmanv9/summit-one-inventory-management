# How It Works: Add Item Wizard

## Problem: Bounce-Around Workflow

Previously, creating a usable inventory item required visiting 3-5 separate pages:

1. **Categories** (`/inventory/categories`) - create a category for SKU generation
2. **Items** (`/inventory/items`) - create the item in a single modal
3. **Vendors** (`/inventory/vendors`) - create a vendor separately
4. **Locations** (`/inventory/locations`) - create a storage location
5. **Stock** (`/inventory/stock`) - adjust inventory to set initial quantities

Users had to mentally track what they'd created, context-switch between pages, and manually link everything together.

## Solution: Guided Wizard Flow

The **Add Item Wizard** (`/inventory/items/new`) lets users create an item and make it operational in one guided flow:

### Step 1: Basics
- Item name, description, category (with inline create), UOM, tracking mode, reorder point
- SKU is auto-generated based on category settings

### Step 2: Vendor (Optional)
- Select or create a preferred vendor inline
- Set vendor SKU and unit cost
- Creates a `vendor_items` link automatically

### Step 3: Starting Stock (Optional)
- Select or create a location inline
- Set initial quantity and unit cost
- Preview shows the ledger entry that will be created

### Step 4: Review & Create
- Summary of all entities to be created
- Single "Create Item" button triggers atomic backend call

### After Success
Optional next actions are offered:
- Create Purchase Order
- Adjust Stock
- Transfer Stock
- Reserve Stock

## Technical Architecture

### Atomic Backend (Single Transaction)

The wizard uses `inventory.rpc_wizard_create_item` - a single Postgres function that:

1. Creates category (if inline create was used)
2. Creates vendor (if inline create was used)
3. Creates location (if inline create was used)
4. Creates the catalog item (delegates to `rpc_create_catalog_item` for SKU generation)
5. Sets `preferred_vendor_id` on the item
6. Creates `vendor_items` link
7. Creates `inventory_levels` (reorder config)
8. Creates `stock_movements` ledger entry (triggers `stock_balances` update)

All in one database transaction. If any step fails, everything rolls back.

### Idempotency

- Each wizard submission generates a unique `idempotency_key`
- The key is used as `last_event_id` on the catalog item
- If the user double-clicks or refreshes, the backend returns the already-created result
- Each sub-entity uses a derived key (`wiz-cat-{key}`, `wiz-ven-{key}`, etc.)

### Event Emission

- Each INSERT fires existing row-level triggers that emit to `events_outbox`
- No special wizard event emission needed - entity triggers handle it
- `inventory.item.wizard_created` is registered in `event_catalog` for documentation

### Tenant Isolation

- `current_tenant_id()` is read from the JWT
- All INSERTs include `tenant_id`
- RLS policies enforce tenant scoping on all tables

## Quick Actions

The Items list now includes a quick actions menu (three-dot menu) on each row:

- **Adjust Stock** - navigate to stock page with item pre-selected
- **Create PO** - navigate to PO creation with item pre-selected
- **Transfer** - navigate to transfers with item pre-selected
- **Reserve** - navigate to reservations with item pre-selected
- **Receive** - navigate to receiving with item pre-selected

## Files Changed

- `supabase/migrations/20260225000000_wizard_create_item.sql` - DB function + constraints
- `src/lib/rpc/inventory.ts` - `wizardCreateItem()` RPC method
- `src/app/(dashboard)/inventory/items/new/page.tsx` - Wizard UI
- `src/app/(dashboard)/inventory/items/page.tsx` - Quick actions + wizard navigation
- `src/components/modals/AddLocationModal.tsx` - Inline location creation
- `src/types/events.ts` - Wizard event type

---

# How It Works: Operational Guardrails

## Problem: Silent Inventory Mistakes

Stock mutations (adjustments, transfers, receiving) could silently create incorrect state:

1. **Negative inventory** - Adjusting below zero with no check (the `stock_balances CHECK (qty_on_hand >= 0)` constraint was a hard wall that made the configurable `negative_inventory_config` feature dead code)
2. **Over-receipt** - Receiving more than a PO's open quantity with no warning
3. **No audit trail** - When overrides were allowed, there was no record of who overrode what and why

## Solution: Configurable Guardrails with Auditable Overrides

### Guardrail Policies (`inventory.guardrail_policies`)

Each tenant has one policy row controlling:

| Setting | Options | Default |
|---------|---------|---------|
| `over_receipt_policy` | `block` / `allow_with_audit` | `block` |
| `over_receipt_threshold_pct` | 0-100 (tolerance before policy triggers) | 0 |
| `uom_mismatch_policy` | `block` / `warn` / `off` | `warn` |
| `require_override_reason` | true/false | true |

Negative inventory is controlled separately by the existing `negative_inventory_config` table (item/category/global scoping).

### How Enforcement Works

Every stock mutation function checks guardrails **before** writing:

1. **`rpc_adjust_inventory`** - Checks if adjustment would make qty negative. If `check_negative_allowed()` returns false, returns structured error `NEGATIVE_INVENTORY_BLOCKED`. If override is allowed but no reason provided, returns `OVERRIDE_REASON_REQUIRED`.

2. **`rpc_post_receipt_to_inventory_v2`** - Checks each receipt line against PO open quantity + threshold tolerance. If over-receipt detected and policy is `block`, returns `OVER_RECEIPT_BLOCKED`.

3. **`rpc_inv_transfer_execute`** - Pre-checks source location balance before executing. If transfer would create negative stock and not allowed, returns `NEGATIVE_INVENTORY_BLOCKED`.

### Structured Error Response

Instead of `RAISE EXCEPTION`, guardrail blocks return structured JSON:

```json
{
  "success": false,
  "error": {
    "code": "NEGATIVE_INVENTORY_BLOCKED",
    "message": "Adjustment would result in negative inventory (-5 EA at Warehouse A)",
    "details": { "item_name": "Widget", "location_name": "Warehouse A", "current_qty": 3, "requested_delta": -8 },
    "action": "Reduce quantity or enable negative inventory for this item"
  }
}
```

Error codes: `NEGATIVE_INVENTORY_BLOCKED`, `OVER_RECEIPT_BLOCKED`, `OVERRIDE_REASON_REQUIRED`, `UOM_MISMATCH_BLOCKED`

### Override Flow

When a policy is `allow_with_audit`:
1. Backend returns `OVERRIDE_REASON_REQUIRED`
2. UI shows an amber override form with a reason text field
3. User submits with `override_reason`
4. Backend logs to `guardrail_exceptions` and proceeds with the mutation
5. The exception is visible in the Override Audit Log at `/settings/guardrails`

### Guardrail Exceptions (`inventory.guardrail_exceptions`)

Every override is logged with:
- `actor_user_id` - who overrode
- `context_type` / `context_id` - what was being mutated (adjustment, transfer, receipt)
- `rule` - which guardrail was overridden
- `override_reason` - free-text reason
- `metadata` - item name, location, quantities, etc.

### Critical Bug Fix

The baseline migration had `CHECK (qty_on_hand >= 0)` on `stock_balances`. This fired at the database constraint level **before** the `maintain_stock_balances` trigger could consult `negative_inventory_config`. The guardrails migration drops this CHECK, making the configurable negative inventory feature functional.

## UI Integration

### Stock Adjustment Modal (`/inventory/stock`)
- Shows red block message for hard guardrail violations
- Shows amber override form when `OVERRIDE_REASON_REQUIRED`
- Disables form fields when hard-blocked
- "Override & Save" button for allowed overrides

### Transfer Receive (`/inventory/transfers`)
- Prompts for override reason when `OVERRIDE_REASON_REQUIRED`
- Shows alert with action message for hard blocks

### Settings Page (`/settings/guardrails`)
- Policy configuration form
- Links to related settings (negative inventory, UOM conversions)
- Override Audit Log table showing recent guardrail exceptions

## Events

- `inventory.guardrail_policy.updated` - emitted when policies are saved
- `inventory.guardrail_exception.created` - emitted when an override is logged

## Files Changed

- `supabase/migrations/20260225200000_guardrails.sql` - Tables, RLS, enforcement in mutation functions
- `src/lib/rpc/inventory.ts` - Guardrail-aware RPC methods, override_reason support
- `src/lib/rpc/supply-chain.ts` - Over-receipt guardrail support in receipt posting
- `src/lib/chat/actions.ts` - Handle guardrail errors from adjustInventory
- `src/app/(dashboard)/inventory/stock/page.tsx` - Guardrail block/override in adjust modal
- `src/app/(dashboard)/inventory/transfers/page.tsx` - Guardrail handling in transfer receive
- `src/app/(dashboard)/settings/guardrails/page.tsx` - Policy settings + audit log
- `src/types/events.ts` - Guardrail event types
