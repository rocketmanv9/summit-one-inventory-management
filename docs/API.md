# API

Last verified: 2026-02-13
Source of truth: runtime code

## Overview
The client uses two layers:
1. API client shim in [src/lib/api-client.ts](src/lib/api-client.ts) for REST-like `/api/*` calls.
2. RPC service layer in [src/lib/rpc](src/lib/rpc) for typed, domain-specific operations.

Both rely on the auth token cache in [src/lib/auth-token.ts](src/lib/auth-token.ts).

## API client shim
The shim keeps legacy `apiWrite` calls but routes inventory and supply-chain requests directly to Supabase.

### Route detection
`authenticatedFetch()` and `apiWrite()` inspect the URL:
- `/api/inventory/*` -> schema `inventory`
- `/api/supply-chain/*` -> schema `supply_chain`

Routes outside those namespaces fall back to normal `fetch`.

### Table mapping
Resource names map to tables via `getTableName()` in [src/lib/api-client.ts](src/lib/api-client.ts):
- items -> catalog_items
- categories -> item_categories
- movements -> stock_movements
- vendor-items -> vendor_items
- location-types -> location_types
- assignment-types -> assignment_types
- cycle-counts -> cycle_counts
- purchasing -> purchase_orders
- everything else -> slug-to-snake conversion

### RPC routing
If the URL includes an action segment (for example `/api/inventory/transfers/123/execute`), the shim tries multiple RPC name candidates, in order:
- `rpc_<singular>_<action>`
- `<singular>_<action>`
- `rpc_<plural>_<action>`
- `<plural>_<action>`
- `rpc_<action>`
- `<action>`

This logic is implemented in `runRpc()` in [src/lib/api-client.ts](src/lib/api-client.ts).

### Auth headers and retry
The shim uses `getStoredAccessToken()` to set `Authorization: Bearer <token>`. On auth errors (401/403, JWT errors, PGRST301), it attempts `refreshAccessToken()` once and retries the request. If that fails, it clears the cached token and redirects to Core login.

### Error handling
- Invalid resources return `400`.
- RPC not found returns `400` with an explicit message.
- Supabase errors return `500`.
- Auth errors return `401` after retry.

## RPC service layer
The service layer provides typed functions for the UI using Supabase RPC and direct table operations.

### Supply chain RPCs
Defined in [src/lib/rpc/supply-chain.ts](src/lib/rpc/supply-chain.ts):
- rpc_get_tenant_settings
- rpc_update_tenant_settings (admin-only check in client)
- rpc_create_purchase_order
- rpc_post_receipt_to_inventory
- rpc_get_open_pos_for_receiving
- rpc_get_recent_receipts
- rpc_get_po_receiving_detail
- rpc_create_receipt_v2

### Inventory RPCs
Defined in [src/lib/rpc/inventory.ts](src/lib/rpc/inventory.ts):
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

## Authenticated requests from the client
Recommended patterns:
- Use `authenticatedFetch()` for REST-like `/api/inventory/*` and `/api/supply-chain/*` routes.
- Use `apiWrite()` for write operations that need idempotency keys.
- Use `createBrowserAuthedClient()` from [src/supabase/client.ts](src/supabase/client.ts) for direct Supabase queries.

These rely on the access token stored in HttpOnly cookies and cached in memory by [src/lib/auth-token.ts](src/lib/auth-token.ts).
