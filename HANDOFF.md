# Session Handoff — May 7, 2026

## What was done this session

### 1. Audit page fix (committed, pushed, deployed)
- `src/app/(dashboard)/inventory/audit/page.tsx` was fetching from `/api/inventory/audit` which never existed (404 → HTML → JSON parse error)
- Rewrote to use client-side `InventoryRPC.getStockMovements()` and added new `InventoryRPC.getInventoryEvents()` method in `src/lib/rpc/inventory.ts`
- Fixed column name mismatches (`qty` → `quantity_delta`, `reference_type` → `source_ref_type`, etc.)

### 2. Mobile layout hydration fix (committed, pushed, deployed)
- `src/app/m/layout.tsx` had its own `<html>` and `<body>` tags nested inside the root layout, causing React #418 hydration error
- Removed duplicate tags — root layout provides them

### 3. Mobile count sessions migration (applied to staging DB)
- Applied `20260507100001_create_mobile_count_sessions.sql` to staging Supabase via MCP
- Table `inventory.mobile_count_sessions` now exists with RLS and tenant-scoped policies

### 4. Cycle count creation route (committed, pushed, deployed)
- Created `src/app/api/inventory/cycle-counts/route.ts` — calls `rpc_inv_cycle_count_start` RPC
- The page posts `catalog_item_ids` which is an RPC parameter, NOT a table column

### 5. Client shim bypass for cycle-counts (committed, pushed, deployed)
- `src/lib/api-client.ts` has a shim (`isShimRoute`) that intercepts ALL `/api/inventory/*` and `/api/supply-chain/*` requests and does direct Supabase table operations instead of hitting API routes
- The shim was doing `.insert({ catalog_item_ids, ... })` into `cycle_counts` table — that column doesn't exist
- Added `cycle-counts` to `SHIM_BYPASS` set so it hits the real API route instead
- **DO NOT disable the entire shim** — 17 other inventory endpoints depend on it

## What still needs to be done

### Critical: 14 missing inventory API routes
The shim in `src/lib/api-client.ts` covers these because real routes don't exist. Each needs a proper route.ts using chassis factories:

1. `POST /api/inventory/alerts/refresh`
2. `POST /api/inventory/alerts/{id}/acknowledge`
3. `POST /api/inventory/alerts/{id}/dismiss`
4. `POST /api/inventory/cycle-counts/{id}/start` — should call `rpc_inv_cycle_count_start` or similar
5. `POST /api/inventory/cycle-counts/{id}/lines/{lineId}/assets`
6. `PATCH /api/inventory/cycle-counts/{id}/lines/{lineId}`
7. `POST /api/inventory/cycle-counts/{id}/lines/{lineId}/decide`
8. `POST /api/inventory/cycle-counts/{id}/submit`
9. `POST /api/inventory/cycle-counts/{id}/approve` — RPC exists: `rpc_inv_cycle_count_approve`
10. `GET /api/inventory/locations`
11. `GET /api/inventory/abc-classification`
12. `POST /api/inventory/abc-classification/calculate`
13. `GET /api/inventory/vendor-performance`
14. `GET /api/inventory/vendor-performance/{id}/events`
15. `POST /api/inventory/movements/{id}/reverse` — RPC exists: `rpc_reverse_stock_movement`

Once all routes exist, remove the shim entirely by setting `isShimRoute` to return `false`.

### Key patterns to follow
- Read `CLAUDE.md` for all route rules
- Use `createSessionWriteRoute` / `createSessionReadRoute` from `@rocketmanv9/chassis/nextjs`
- Access inventory schema: `(supabase as any).schema('inventory')`
- Check for existing RPCs: `SELECT routine_name FROM information_schema.routines WHERE routine_schema = 'inventory'`
- Add each resource to `SHIM_BYPASS` in `src/lib/api-client.ts` as you build its routes

### Mobile cycle count testing
- Migration applied to staging DB
- All code pushed to `stage` branch
- Flow: Desktop cycle count page → "Mobile Count (QR Code)" button → generate QR → scan on phone → `/m/count/{token}`
- Needs end-to-end testing once a cycle count is in `in_progress` status

## Branch state
- Working branch: `stage`
- Main branch: `dev`
- Latest commit: `3877796` — "fix: restore shim, only bypass for cycle-counts"
