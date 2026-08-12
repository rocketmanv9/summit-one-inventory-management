# Database

Last verified: 2026-05-14
Source of truth: runtime code + migrations

## Schema overview
The database uses three custom schemas plus the default public schema. The baseline schema is defined in [supabase/migrations/00000000000000_baseline.sql](../supabase/migrations/00000000000000_baseline.sql), with ~30 additional migrations applied on top.

- **inventory** - Core inventory domain (catalog, stock, assets, transfers, reservations, cycle counts, alerts, ABC classification, guardrails)
- **supply_chain** - Procurement domain (vendors, purchase orders, receipts, tenant settings)
- **public** - Shared tables (tenants, dashboards/widgets, event outbox, AI conversations, local users, tenant branding)

## Key tables (by schema)

### inventory
Used by RPC wrappers in [src/lib/rpc/inventory.ts](../src/lib/rpc/inventory.ts) and API routes:
- `catalog_items`, `item_categories` - Item catalog
- `locations`, `location_types` - Storage locations
- `inventory_levels`, `stock_balances`, `stock_movements` - Stock tracking
- `assets`, `asset_state`, `asset_assignments` - Serialized asset management
- `reservations`, `reservation_types` - Inventory reservations
- `transfers`, `transfer_lines` - Inter-location transfers
- `assignment_types` - Assignment type config
- `cycle_counts`, `cycle_count_lines`, `cycle_count_assets` - Cycle counting
- `alerts` - Inventory alerts (reorder, stockout)
- `guardrail_policies`, `guardrail_exceptions` - Operational guardrails
- `item_snapshots`, `daily_item_activity` - Reporting snapshots
- `mobile_count_sessions` - Mobile cycle count sessions
- `sku_settings` - SKU generation config
- `negative_inventory_config` - Per-tenant negative inventory settings
- `apparel_items`, `apparel_sizes` - Apparel workflow

### supply_chain
Used by RPC wrappers in [src/lib/rpc/supply-chain.ts](../src/lib/rpc/supply-chain.ts):
- `vendors`, `vendor_items`, `vendor_contacts`, `vendor_addresses` - Vendor management
- `purchase_orders`, `purchase_order_lines` - Purchasing
- `receipts`, `receipt_lines` - Receiving
- `supplier_catalogs`, `supplier_pricing` - Supplier catalogs
- `tenant_settings` - Per-tenant supply chain config

### public
- `tenants` - Tenant registry
- `local_users` - Service-local user records
- `tenant_branding` - Per-tenant branding config
- `dashboards`, `dashboard_widgets`, `widget_registry` - Dashboard system
- `event_definitions`, `event_consumers`, `processed_events`, `events_dead_letter` - Event infrastructure
- `summit_config`, `event_catalog` - Platform config
- `ai_conversations`, `ai_messages`, `ai_usage_log`, `ai_memory` - AI chat storage
- `enrichment_log` - Data enrichment audit

## RLS and tenant isolation
All tenant-scoped tables enforce RLS with `tenant_id = public.current_tenant_id()`.

- `inventory.auto_inject_tenant_id()` - BEFORE INSERT trigger that injects tenant_id from JWT claims (`app_metadata.tenant_id` or `app_metadata.tenantId`)
- `public.current_tenant_id()` - Resolves tenant_id from session settings or JWT claims

## RPC functions
RPCs called from the application (defined in migrations):

### Inventory RPCs (called from src/lib/rpc/inventory.ts and API routes)
- `rpc_create_catalog_item` - Create item with SKU generation
- `rpc_wizard_create_item` - Atomic item creation wizard (category + vendor + location + item + stock)
- `rpc_get_sku_settings` - Get SKU generation config
- `rpc_issue_inventory` - Issue stock from a location
- `rpc_adjust_inventory` - Adjust stock quantities with guardrail checks
- `rpc_reverse_stock_movement` - Reverse a stock movement
- `rpc_inv_asset_assign` / `rpc_inv_asset_return` - Asset assignment lifecycle
- `rpc_inv_reserve_fungible` / `rpc_inv_reserve_asset` - Reserve inventory
- `rpc_inv_find_available_assets` - Find available serialized assets
- `rpc_inv_fulfill_reservation_issue` / `rpc_inv_release_reservation` - Fulfill/release reservations
- `rpc_inv_undo_fulfill_reservation` / `rpc_inv_undo_release_reservation` - Undo reservation actions
- `rpc_inv_transfer_create` / `rpc_inv_transfer_execute` - Create and execute transfers
- `rpc_inv_transfer_receive_partial` - Partial transfer receipt
- `rpc_inv_transfer_undo_cancel` / `rpc_inv_transfer_create_reversal` - Transfer corrections
- `rpc_inv_transfer_undo_shipment` / `rpc_inv_transfer_reverse_receipt` - Undo transfer operations
- `rpc_inv_cycle_count_start` / `rpc_inv_cycle_count_approve` / `rpc_inv_cycle_count_record` - Cycle count workflow
- `rpc_calculate_abc_classification` - ABC analysis
- `rpc_acknowledge_alert` / `rpc_dismiss_alert` - Alert management
- `rpc_item_stock_snapshot` / `rpc_location_inventory_snapshot` - Snapshot RPCs
- `rpc_global_search` - Cross-entity search
- `rpc_claim_device` - Device onboarding

### Supply chain RPCs (called from src/lib/rpc/supply-chain.ts)
- `rpc_get_tenant_settings` / `rpc_update_tenant_settings` - Tenant settings (admin-only write)
- `rpc_create_purchase_order` - Create PO with auto-numbering
- `rpc_get_open_pos_for_receiving` / `rpc_get_po_receiving_detail` - Receiving queries
- `rpc_get_recent_receipts` - Recent receipt history
- `rpc_post_receipt_to_inventory` - Post receipt with guardrail checks
- `rpc_create_receipt_v2` - Create receipt record
- `rpc_report_reorder_suggestions` - Reorder point analysis

## Migrations
Migration files live in [supabase/migrations/](../supabase/migrations/). There are ~30 migration files. The baseline creates the full schema; subsequent migrations add features, fix RPCs, and harden RLS.

Do not manually list migrations here - they change frequently. Use `ls supabase/migrations/` to see the current list.

## Running migrations
- **Remote environments:** CI applies migrations automatically via `supabase db push` on push to dev/stage/prod
- **Local Supabase (if needed):** `npm run sb:start` applies migrations on startup
