# Writes → Chassis Routes Migration — HANDOFF / CONTINUATION

**Read this first to resume the migration after a /compact or fresh session.**
Goal: move the remaining direct browser→Postgres writes (`InventoryRPC.*` /
`SupplyChainRPC.*`) onto chassis route factories for idempotency + server-side
zod validation. Branch: **stage**. Commit + push each table/wave.

## Status (as of 2026-05-30)

**DONE + verified + pushed (11 tables):** location_types, item_categories,
assignment_types, reservation_types, uom_conversions, locations, vendor_items,
negative_inventory_config, guardrail_policies, sku_settings, inventory_levels.
Plus: double-emit fix (emissionOwner:'trigger' on 14 routes) and a real bug fix
(vendor_items writes now hit the real `supply_chain` table, not the inventory VIEW).
Commits on stage: d552eb7, 4f234e1, 8e15ed5, a2ce224, 260f453 (+ earlier 93394d1 = chassis 2.0.0 adoption).

**REMAINING (4 high-risk tables):**
1. **catalog_items** — `updateCatalogItem`/`deleteCatalogItem` (~line 628/710 in src/lib/rpc/inventory.ts).
   TRAP: the existing `items/[id]` route does a PLAIN update (no version check); the RPC uses OCC
   (`.eq('last_event_id', lastEventId)`). Must add OCC to items/[id] PATCH (or new route) or you LOSE
   optimistic concurrency. Also `reassignCatalogItemsCategory` (bulk update) needs a route. `createCatalogItem`
   already uses `rpc_create_catalog_item` (leave it).
2. **assets** — createAsset/updateAsset/deleteAsset (~src/lib/rpc/inventory.ts). TRAP: createAsset does a
   SECONDARY write (an update near line ~947 in addition to the insert). assignAsset/returnAsset use RPCs (leave).
3. **vendors** (supply_chain) — createVendor/updateVendor/deleteVendor in src/lib/rpc/supply-chain.ts. TRAP:
   createVendor has a secondary update. No supply-chain vendor route exists yet — create under /api/inventory/vendors-sc or similar.
4. **transfers** — updateTransfer (4 writes: header + delete lines + update lines + insert lines), shipTransfer
   (loop), cancelTransfer, in src/lib/rpc/inventory.ts (~line 1431+). DO LAST. Needs a real stage-DB
   transactional test. createTransfer/receive* use RPCs (leave).

## The proven pattern (replicate it)

- **Helper:** `src/lib/api/typed-crud.ts` — `listRoute`, `createRoute({schema,table,bodySchema,mode:'insert'|'upsert',onConflict,emissionOwner,returning})`,
  `updateRouteOCC`, `deleteRouteOCC` (optimistic concurrency via `expected_last_event_id`),
  `updateRoute`/`deleteRoute` (non-OCC, by id), `idFromPath(req, segment)`.
- **Route conventions (chassis 2.0.0):** every write route REQUIRES `bodySchema` (zod) — or `'raw'`.
  `emissionOwner: 'trigger'` for tables that HAVE an event trigger (return `events: []`); `'route'` for tables
  WITHOUT a trigger. Stamp `last_event_id: idempotencyKey` on insert/update. `[id]` extracted via `idFromPath`/`extractId`.
- **Repoint:** in the RPC layer, use the local `writeJson(url, method, body, errMsg)` helper (already added to
  inventory.ts AND supply-chain.ts). It preserves return shape (`json.data`) and maps 409 → `AppError.conflict`
  (keeps optimistic-concurrency UX). Keep client-side stripping of non-column fields (id/created_at/tenant_id/
  last_event_id/joined-relations) BEFORE calling the route, and pass `expected_last_event_id: lastEventId` for OCC.
- Pages are UNCHANGED — they still call `InventoryRPC.x` / `SupplyChainRPC.x`; only the method bodies change.

## Verification (every table)

1. `npx tsc --noEmit` → 0 errors. `npm run build` → compiled. `npx vitest run` → 107 pass.
2. Exercise the route logic against the **stage** DB via the `supabase_stage` MCP `execute_sql`
   (project ref **qnbrrutjbyrjmwohcbcv**). Use a `do $$ ... $$` block with test tenant
   `052abee2-ffdc-470e-975a-b917dde72b8e`, `set_config('app.current_tenant_id', <tenant>, true)`,
   assert insert/OCC-update(match=1 row)/stale(0 rows = 409)/delete, then clean up. (DO blocks roll back
   atomically on error, so failed test scripts leave nothing behind.)
3. Commit + push to stage with a clear message.

## Environment facts (IMPORTANT — my saved notes were mislabeled)

- **stage = `qnbrrutjbyrjmwohcbcv`** — set up correctly; `supabase_stage` MCP `execute_sql` works; HAS idempotency_claim.
- **main/prod = `cwmsvmywairkwdmvkdmw`** — what `.env.local` points at; **MISSING `idempotency_claim`** (route writes 500 there until a deploy applies the migration). DO NOT run DDL on main. Don't run the app against it for write testing.
- Cannot run the app against stage locally (no stage app creds in repo). So verification is **code + stage-DB**, not UI click-through. User click-tests on the stage DEPLOY.
- `supabase_dev` MCP OAuth is broken in this env ("Unrecognized client_id") — don't rely on it.

## Open flag for the user
main/prod is missing the chassis idempotency migration — confirm the prod deploy runs the Supabase migration step, or route-based writes 500 in prod.
