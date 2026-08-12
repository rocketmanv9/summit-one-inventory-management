# Writes → Chassis Routes Migration — HANDOFF / CONTINUATION

**STATUS: COMPLETE (2026-05-30).** All 15 tables migrated, verified (tsc/build/107
tests/compliance + stage-DB logic tests), and the work is on branch **stage**.
This doc is kept as the record of what was done + traps for anyone touching these paths.

Goal was: move the direct browser→Postgres writes (`InventoryRPC.*` /
`SupplyChainRPC.*`) onto chassis route factories for idempotency + server-side
zod validation.

## Status

**DONE + verified + pushed (all 15 tables):** location_types, item_categories,
assignment_types, reservation_types, uom_conversions, locations, vendor_items,
negative_inventory_config, guardrail_policies, sku_settings, inventory_levels,
**catalog_items, assets, vendors (supply_chain), transfers**.
Plus: double-emit fix (emissionOwner:'trigger'), vendor_items VIEW→real-table fix,
and a real DB bug fix: `emit_catalog_item_event()` had no DELETE branch, so hard-
deleting a catalog item raised a NOT NULL violation on events_outbox.event_type
(migration `20260530000001_fix_catalog_item_delete_event.sql`, applied to stage).

**Final wave (catalog_items, assets, vendors, transfers) — what was built:**
1. **catalog_items** — `items/[id]` PATCH/DELETE upgraded to OCC (expected_last_event_id);
   new `items/reassign-category` route runs the bulk reassign loop server-side with per-row OCC.
   createCatalogItem still uses `rpc_create_catalog_item`.
2. **assets** — new `assets` POST (create-or-restore-retired) + `assets/[id]` PATCH (OCC) / DELETE
   (soft retire, OCC). TRAP HANDLED: POST sets `tenant_id: ctx.tenantId` explicitly —
   auto_inject_tenant_id() REFUSES to inject under the service-role client and raises.
3. **vendors** (supply_chain) — new `vendors` POST (create-or-restore-inactive, explicit tenant_id) +
   `vendors/[id]` PATCH (OCC) / DELETE (deactivate, OCC). Targets `supply_chain` schema.
4. **transfers** — `transfers/[id]` PATCH (header + line reconciliation, per-row OCC),
   `transfers/[id]/ship`, `transfers/[id]/cancel`. TRAP HANDLED: new transfer_lines need explicit
   tenant_id (no inject trigger on that table) — taken from the parent transfer's tenant_id.
   createTransfer/receive*/undo/reversal still use RPCs.

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
