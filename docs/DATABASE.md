# Database

Last verified: 2026-02-13
Source of truth: runtime code

## Schema overview
The database is split into three schemas, all present in [supabase/migrations/20260106000000_remote_schema.sql](supabase/migrations/20260106000000_remote_schema.sql):

- inventory: core inventory domain (catalog, stock, assets, transfers, reservations, cycle counts)
- supply_chain: procurement domain (vendors, purchase orders, receipts, tenant settings)
- public: shared tables, dashboards/widgets, and the event outbox view

## Key tables (by schema)

### inventory
Used directly by the UI and RPC wrappers in [src/lib/rpc/inventory.ts](src/lib/rpc/inventory.ts):
- catalog_items, item_categories
- locations, location_types
- inventory_levels, stock_balances, stock_movements
- assets, asset_state, asset_assignments
- reservations, reservation_types
- transfers, transfer_lines
- assignment_types
- cycle_counts and related cycle count tables

### supply_chain
Used directly by the UI and RPC wrappers in [src/lib/rpc/supply-chain.ts](src/lib/rpc/supply-chain.ts):
- vendors, vendor_items
- purchase_orders, purchase_order_lines
- receipts, receipt_lines
- tenant_settings

### public
Used for multi-tenant metadata and dashboards:
- tenants
- dashboards, dashboard_widgets
- widget_registry
- event_definitions, event_consumers, processed_events, events_dead_letter
- summit_config
- views: event_catalog, events_outbox

## RLS and tenant isolation
Tenant isolation is enforced by RLS policies that typically require `tenant_id = public.current_tenant_id()`.

From [supabase/migrations/20260209000010_ensure_tenant_exists.sql](supabase/migrations/20260209000010_ensure_tenant_exists.sql) and [supabase/migrations/20260209000009_fix_tenant_settings_last_event_id.sql](supabase/migrations/20260209000009_fix_tenant_settings_last_event_id.sql):
- `inventory.auto_inject_tenant_id()` injects tenant_id on insert using JWT claims.
- `public.current_tenant_id()` resolves tenant_id from session settings or JWT claims.

Many tenant-scoped tables attach `inventory.auto_inject_tenant_id()` as a BEFORE INSERT trigger (example: `inventory.sku_settings` in [supabase/migrations/20260206000007_add_sku_generation_schema.sql](supabase/migrations/20260206000007_add_sku_generation_schema.sql)).

## RPC functions available
These are the RPCs called by the app in [src/lib/rpc](src/lib/rpc):

Supply chain:
- rpc_get_tenant_settings
- rpc_update_tenant_settings
- rpc_create_purchase_order
- rpc_post_receipt_to_inventory
- rpc_get_open_pos_for_receiving
- rpc_get_recent_receipts
- rpc_get_po_receiving_detail
- rpc_create_receipt_v2

Inventory:
- rpc_issue_inventory
- rpc_adjust_inventory
- rpc_get_sku_settings
- rpc_create_catalog_item
- rpc_inv_asset_assign
- rpc_inv_asset_return
- rpc_inv_reserve_fungible
- rpc_inv_reserve_asset
- rpc_inv_find_available_assets
- rpc_inv_fulfill_reservation_issue
- rpc_inv_release_reservation
- rpc_inv_undo_fulfill_reservation
- rpc_inv_undo_release_reservation
- rpc_inv_transfer_create
- rpc_inv_transfer_execute
- rpc_inv_transfer_receive_partial
- rpc_inv_transfer_undo_cancel
- rpc_inv_transfer_create_reversal
- rpc_inv_transfer_undo_shipment
- rpc_inv_transfer_reverse_receipt
- rpc_reverse_stock_movement

## Running migrations
- Local Supabase: `npm run sb:start` (runs Supabase locally and applies migrations).
- Remote environments: use Supabase CLI to push migrations (for example `supabase db push`).

## Migration files
Current migrations in [supabase/migrations](supabase/migrations):

- 20260106000000_remote_schema.sql
- 20260122000001_fix_widget_registry_rls.sql
- 20260122000002_make_location_types_tenant_specific.sql
- 20260122000003_fix_location_type_to_use_id.sql
- 20260122000004_make_old_location_type_nullable.sql
- 20260122000005_remove_deprecated_location_type_column.sql
- 20260122000006_fix_location_event_trigger.sql
- 20260122000007_cleanup_catalog_items_uom_columns.sql
- 20260122000008_fix_catalog_item_event_trigger.sql
- 20260122000009_create_assignment_types.sql
- 20260123000000_add_vendor_items_view.sql
- 20260123000001_grant_supply_chain_permissions.sql
- 20260123000002_seed_supply_chain_data.sql.disabled
- 20260123000003_fix_supply_chain_triggers.sql
- 20260123000004_fix_vendor_performance_event_emission.sql
- 20260123200000_construction_friendly_pos.sql
- 20260123210000_vendor_ordering_modes.sql
- 20260123220000_fix_service_role_rls_bypass.sql
- 20260123230000_actually_fix_service_role_rls.sql
- 20260124000001_comprehensive_security_hardening.sql
- 20260126000001_reseed_widget_registry_production.sql
- 20260126000002_add_soft_delete_to_dashboards.sql
- 20260126000003_fix_transfer_event_scope.sql
- 20260126000010_seed_inventory_operations.sql.disabled
- 20260127000001_fix_fulfill_reservation_validation.sql
- 20260127000002_seed_test_data.sql.disabled
- 20260127000002_validate_transfer_stock.sql
- 20260127000003_fix_transfer_number_generation.sql
- 20260127000004_fix_stock_balances_trigger.sql
- 20260127000005_fix_transfer_execute_event_scope.sql
- 20260127000006_add_partial_receive_support.sql
- 20260127000007_add_partial_receive_rpcs.sql
- 20260127000008_update_full_receive_set_shipped.sql
- 20260127000009_fix_reversal_qty_fallback.sql
- 20260127000010_add_transfer_corrections.sql
- 20260127000011_add_fungible_serialized_reservations.sql
- 20260127000012_update_fulfill_release_for_serialized.sql
- 20260127000013_add_reservation_undo_functions.sql
- 20260127000014_fix_transfer_create_for_serialized.sql
- 20260127000015_add_transfer_undo_cancel.sql
- 20260128000000_enhance_receiving_workflow.sql
- 20260128000001_create_tenant_settings.sql
- 20260128000002_add_vendor_auto_approve_limits.sql
- 20260128000003_implement_cycle_count_workflow.sql
- 20260128000004_register_cycle_count_events.sql
- 20260128000005_implement_rfid_infrastructure.sql
- 20260128000006_register_rfid_events.sql
- 20260128000007_create_rfid_device_api.sql
- 20260128000008_create_rfid_tag_assignment_api.sql
- 20260128000009_receiving_query_rpcs.sql
- 20260128000010_enhanced_receipt_rpcs.sql
- 20260129000001_fix_rls_tenant_injection.sql
- 20260129000002_add_cycle_count_number_format_settings.sql
- 20260129000003_add_adjustment_tracking.sql
- 20260129000004_cycle_count_asset_tracking.sql
- 20260129000005_add_variance_decision_fields.sql
- 20260129000006_fix_jwt_tenant_id_extraction.sql
- 20260129000007_support_both_jwt_tenant_paths.sql
- 20260129000010_add_atomic_po_number_generation.sql
- 20260130000100_enforce_last_event_id_constraints.sql
- 20260130161507_fix_recent_receipts_rpc.sql
- 20260130162025_grant_events_outbox_permissions.sql
- 20260130164007_fix_inventory_table_permissions.sql
- 20260130165000_fix_stock_movements_permissions_and_rpc.sql
- 20260130170000_fix_item_categories_permissions.sql
- 20260130170100_fix_rpc_jwt_path.sql
- 20260130172000_fix_rpc_column_name.sql
- 20260206000000_init_hybrid_schema.sql
- 20260206000002_fix_item_categories_write_permissions.sql
- 20260206000003_add_item_categories_tenant_trigger.sql
- 20260206000004_fix_current_tenant_id_fallback.sql
- 20260206000005_fix_set_audit_fields_auth_uid.sql
- 20260206000006_drop_item_categories_auth_fkeys.sql
- 20260206000007_add_sku_generation_schema.sql
- 20260206000008_add_inventory_levels_location_stock.sql
- 20260206000009_add_location_types_tenant_trigger.sql
- 20260208000001_option_a_device_onboarding.sql
- 20260209000001_device_onboarding_hardening.sql
- 20260209000002_grant_asset_state_read.sql
- 20260209000003_fix_vendor_rls_insert.sql
- 20260209000004_add_supply_chain_tenant_triggers.sql
- 20260209000005_fix_vendor_rls_jwt_paths.sql
- 20260209000006_make_vendor_sku_nullable.sql
- 20260209000007_vendor_code_settings.sql
- 20260209000008_fix_tenant_settings_rpc.sql
- 20260209000009_fix_tenant_settings_last_event_id.sql
- 20260209000010_ensure_tenant_exists.sql
- 20260209000011_skip_vendor_code_validation_on_deactivate.sql
- 20260209000012_fix_adjust_inventory_auth.sql
- 20260209000013_fix_adjust_inventory_event_columns.sql
- 20260209000014_fix_adjust_inventory_movement_type.sql
- 20260209000015_add_reservation_destination.sql
- 20260209000016_reservation_destination_rpc.sql
- 20260209000017_reservation_types.sql
- 20260209000018_grant_delete_reservation_types.sql
- 20260209000019_fix_transfer_lines_rls_policy.sql
- 20260209000020_skip_vendor_code_validation_on_reactivate.sql
- 20260209000021_fix_po_rpc_jwt_tenant_id.sql
- 20260209000022_fix_po_rpc_with_auto_number.sql
- 20260209000023_fix_po_rpc_order_date.sql
- 20260209000024_fix_po_rpc_remove_events.sql
- 20260209000025_fix_purchase_orders_rls_jwt_paths.sql
- 20260209000026_fix_purchase_orders_rls_complete.sql
- 20260209000027_fix_receipts_rls_and_rpc.sql
- 20260209000028_drop_duplicate_receiving_rpcs.sql
- 20260209000029_fix_create_receipt_jwt.sql
- 20260209000030_auto_generate_receipt_number.sql
- 20260210000001_add_transfer_assets.sql
- 20260211090000_dashboard_outbox_hardening.sql
- 20260212000000_add_summit_publisher_protocol.sql
- 20260212000001_fix_emit_event_calls.sql
- 20260212000002_update_summit_bot_password.sql
- 20260212000003_register_all_events.sql
- 20260212000100_add_trace_id_to_inventory_outbox.sql
- 20260212000110_add_correlation_id_to_inventory_outbox.sql
- 20260212000120_fix_outbox_scope_default.sql
- 20260212000130_fix_outbox_aggregate_id_default.sql
- 20260212000140_fix_publish_event_aggregate_id.sql
- 20260212000150_fix_outbox_aggregate_id_trigger.sql
- 20260212000160_add_emit_event_3arg_shim.sql
- 20260212000170_fix_emit_event_stock_triggers.sql
- 20260212000180_fix_emit_event_actor_user_id_guard.sql
- 20260212000190_add_rpc_get_sku_settings.sql
- 20260212000200_fix_sku_next_sequence_from_sku.sql
- 20260212000210_fix_sku_sequence_prefix_aware.sql
- 20260212000220_fix_sku_regex_parentheses.sql
- 20260212000230_fix_sku_sequence_prefix_scope.sql
- 20260212000240_add_rpc_create_catalog_item_atomic.sql
- 20260212000250_fix_rpc_create_catalog_item_ambiguity.sql
- 20260213000000_enforce_admin_role_tenant_settings_rpc.sql
- 20260213000001_enforce_admin_assignment_types_rls.sql
