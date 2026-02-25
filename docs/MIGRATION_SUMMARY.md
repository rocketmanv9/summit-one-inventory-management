# Migration Summary

## 20260225000000_wizard_create_item.sql

**Purpose:** Add Item Wizard - atomic item creation with inline dependencies

### New Function
- `inventory.rpc_wizard_create_item` - SECURITY DEFINER function that atomically creates:
  - Category (optional inline create)
  - Vendor (optional inline create, cross-schema to supply_chain)
  - Location (optional inline create)
  - Catalog item (delegates SKU generation to existing `rpc_create_catalog_item`)
  - Vendor-item link
  - Inventory levels (reorder config)
  - Initial stock movement + balance update

### New Constraints (idempotency)
Added `(tenant_id, last_event_id) UNIQUE` constraints (if not already existing) on:
- `inventory.item_categories`
- `inventory.locations`
- `supply_chain.vendors`
- `supply_chain.vendor_items`
- `inventory.stock_movements`
- `inventory.inventory_events`

These enable `ON CONFLICT DO NOTHING` for idempotent wizard re-runs.

### Event Catalog
- Registered `inventory.item.wizard_created` in `public.event_catalog`

### Grants
- `EXECUTE` granted to `authenticated` and `service_role`

### Breaking Changes
None. Existing functions and tables are unmodified. New constraints are additive.

### Rollback
```sql
DROP FUNCTION IF EXISTS inventory.rpc_wizard_create_item;
DELETE FROM public.event_catalog WHERE event_key = 'inventory.item.wizard_created';
-- Constraints can be left in place (they don't break existing behavior)
```
