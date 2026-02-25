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

---

## 20260225200000_guardrails.sql

**Purpose:** Operational guardrails - configurable policies to prevent inventory mistakes with auditable overrides

### Bug Fix
- **Drops `stock_balances_qty_on_hand_check`** - The `CHECK (qty_on_hand >= 0)` constraint on `stock_balances` made the `negative_inventory_config` feature from the feature_expansion migration non-functional. The CHECK fired before the trigger could consult the config. Negative inventory is now enforced at the function level via `check_negative_allowed()`.

### New Tables
- **`inventory.guardrail_policies`** - One row per tenant. Columns: `over_receipt_policy`, `over_receipt_threshold_pct`, `uom_mismatch_policy`, `require_override_reason`. Has `last_event_id UNIQUE` for idempotency.
- **`inventory.guardrail_exceptions`** - Audit log of overrides. Columns: `actor_user_id`, `context_type`, `context_id`, `rule`, `override_reason`, `metadata jsonb`. Has `last_event_id UNIQUE` for idempotency.

### RLS Policies
Both tables have SELECT/INSERT/UPDATE/DELETE policies scoped to `current_tenant_id()`.

### New Functions
- **`inventory.get_guardrail_policies(p_tenant_id)`** - Returns the tenant's guardrail policy row (or defaults if none exists)
- **`inventory.log_guardrail_exception(...)`** - Inserts an audit record into `guardrail_exceptions`

### Modified Functions
- **`inventory.rpc_adjust_inventory`** - New signature with `p_override_reason text DEFAULT NULL`. Pre-checks negative inventory via `check_negative_allowed()`. Returns structured JSON errors instead of raising exceptions for guardrail blocks.
- **`inventory.rpc_post_receipt_to_inventory_v2`** - New signature with `p_override_reason text DEFAULT NULL`. Pre-checks all PO-linked receipt lines against open quantity + threshold tolerance.
- **`inventory.rpc_inv_transfer_execute`** - **Return type changed from `boolean` to `jsonb`**. Pre-checks source balance before executing. Returns structured error if transfer would create disallowed negative inventory.

### Event Catalog
Registered:
- `inventory.guardrail_policy.updated`
- `inventory.guardrail_exception.created`

### Grants
`EXECUTE` granted to `authenticated` and `service_role` on all new/modified functions.

### Breaking Changes
- `rpc_inv_transfer_execute` return type changed from `boolean` to `jsonb`. Frontend callers must handle the new structured response.
- `rpc_adjust_inventory` signature changed (new optional param). Existing callers are unaffected due to DEFAULT NULL.
- `rpc_post_receipt_to_inventory_v2` signature changed (new optional param). Existing callers are unaffected due to DEFAULT NULL.

### Rollback
```sql
-- Restore CHECK constraint
ALTER TABLE inventory.stock_balances ADD CONSTRAINT stock_balances_qty_on_hand_check CHECK (qty_on_hand >= 0);

-- Drop new tables
DROP TABLE IF EXISTS inventory.guardrail_exceptions;
DROP TABLE IF EXISTS inventory.guardrail_policies;

-- Drop new functions
DROP FUNCTION IF EXISTS inventory.get_guardrail_policies;
DROP FUNCTION IF EXISTS inventory.log_guardrail_exception;

-- Note: rpc_adjust_inventory, rpc_post_receipt_to_inventory_v2, and rpc_inv_transfer_execute
-- would need to be restored from the baseline/feature_expansion migrations.

-- Clean up event catalog
DELETE FROM public.event_catalog WHERE event_key IN (
  'inventory.guardrail_policy.updated',
  'inventory.guardrail_exception.created'
);
```
