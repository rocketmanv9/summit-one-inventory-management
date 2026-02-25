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
