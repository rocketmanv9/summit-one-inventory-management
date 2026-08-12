# Migration Plan — Direct Browser Writes → Chassis Routes

**Status:** PLAN ONLY. No code changed, nothing migrated, nothing committed.
**Scope:** the ~47 client-side **writes** (insert/update/delete/upsert) in
`src/lib/rpc/inventory.ts`, `src/lib/rpc/supply-chain.ts`, and
`src/lib/api/purchase-orders.ts`. Reads (select) are explicitly out of scope.

## How the columns were verified
- **Table/op/method:** mapped each write line to the nearest `.from()` and its
  enclosing method (verified by reading both files' structure).
- **Event today:** verified against the actual DB triggers across *all*
  migrations (baseline, `event_compliance`, `feature_expansion`, `guardrails`).
  **Only two write-target tables have NO event-emitting trigger:**
  `sku_settings` and `inventory_levels`. Every other target already emits to the
  outbox via an `AFTER INSERT/UPDATE/DELETE` trigger. *(This was double-checked —
  an early quoted-identifier scan gave false negatives on the multi-line
  `event_compliance` triggers; the final numbers below use a multiline scan.)*
- **Route exists:** verified by reading the candidate route files, not by name.

## ⚠️ The headline finding that reshapes this migration
Because almost every target table **already emits events via a DB trigger**, the
risk here is **NOT** "writes emit no events." It's the opposite for most tables:
the **existing** write routes (`items`, `categories`, `vendor-items`,
`purchasing`) **both** return an `events:[]` array **and** sit on a trigger-backed
table — so they **double-emit** today (route event + trigger event, often under
different names). Any migration must pick ONE emission source per table. See
Gotcha G1 — it is the single most important decision and should be made before
batch 1.

So the real wins from this migration are: **idempotency guards**,
**server-side validation**, and **killing the fake-idempotency sites** — not
"adding events."

---

## 1. Full inventory of direct writes

Legend — Event today: ✅ trigger emits · ❌ no event at all.
Route: ✅ exists · ◑ partial (create only) · ❌ none.
Risk: 🔴 high · 🟠 med · 🟢 low.

### `src/lib/rpc/inventory.ts` (37 writes)

| # | Line | Op | Table | Method / user action | Event today | Route exists | Risk | Notes |
|---|------|----|-------|----------------------|-------------|--------------|------|-------|
| 1 | 400 | update | catalog_items | `reassignCatalogItemsCategory` — bulk move items to new category | ✅ | ◑ (items PATCH is single-id) | 🟠 | bulk update, no bulk route |
| 2 | 447 | insert | item_categories | `createItemCategory` | ✅ | ✅ categories POST | 🟢 | |
| 3 | 472 | update | item_categories | `updateItemCategory` (takes `lastEventId`) | ✅ | ❌ (no categories/[id]) | 🟠 | |
| 4 | 496 | delete | sku_settings | `deleteItemCategory` — cascades sku_settings first | ❌ | ❌ | 🟠 | no-event + multi-table |
| 5 | 505 | delete | item_categories | `deleteItemCategory` | ✅ | ❌ | 🟠 | paired with #4 (one route) |
| 6 | 552 | insert | location_types | `createLocationType` | ✅ | ❌ (route is GET-only) | 🟢 | |
| 7 | 570 | delete | location_types | `deleteLocationType` | ✅ | ❌ | 🟢 | |
| 8 | 600 | update | location_types | `updateLocationType` | ✅ | ❌ | 🟢 | |
| 9 | 642 | upsert | sku_settings | `upsertSkuSettings` (onConflict category_id) | ❌ | ❌ | 🟠 | **no event**; SKU counter |
| 10 | 691 | update | catalog_items | `updateCatalogItem` (takes `lastEventId`) | ✅ | ✅ items/[id] PATCH | 🟢 | |
| 11 | 714 | delete | catalog_items | `deleteCatalogItem` | ✅ | ✅ items/[id] DELETE | 🟢 | |
| 12 | 756 | upsert | inventory_levels | `upsertInventoryLevels` (onConflict item,location) | ❌ | ❌ | 🟠 | **no event**; reorder thresholds |
| 13 | 806 | insert | assignment_types | `createAssignmentType` | ✅ | ❌ (route GET-only) | 🟢 | |
| 14 | 831 | update | assignment_types | `updateAssignmentType` | ✅ | ❌ | 🔴 | **`last_event_id: crypto.randomUUID()` — fake idempotency** |
| 15 | 854 | delete | assignment_types | `deleteAssignmentType` | ✅ | ❌ | 🟢 | |
| 16 | 947 | update | assets | `createAsset` — secondary write in create path | ✅ | ❌ | 🟠 | confirm intent (dedup/relink?) |
| 17 | 967 | insert | assets | `createAsset` | ✅ | ❌ | 🔴 | asset = inventory-critical |
| 18 | 992 | update | assets | `updateAsset` (takes `lastEventId`) | ✅ | ❌ | 🟠 | |
| 19 | 1016 | update | assets | `deleteAsset` — soft delete `status='retired'`, `last_event_id: nextEventId` | ✅ | ❌ | 🟠 | |
| 20 | 1436 | update | transfers | `updateTransfer` — header | ✅ | ❌ | 🔴 | **stock-moving**; part of 4-write method |
| 21 | 1469 | delete | transfer_lines | `updateTransfer` — clear lines | ✅ | ❌ | 🔴 | same method as #20 |
| 22 | 1490 | update | transfer_lines | `updateTransfer` — update lines | ✅ | ❌ | 🔴 | same method |
| 23 | 1504 | insert | transfer_lines | `updateTransfer` — add lines | ✅ | ❌ | 🔴 | same method → **needs one transactional route** |
| 24 | 1541 | update | transfer_lines | `shipTransfer` — set `qty_shipped` in a **loop** | ✅ | ❌ | 🔴 | loop write |
| 25 | 1552 | update | transfers | `shipTransfer` — `status='in_transit'` | ✅ | ❌ | 🔴 | paired with #24 |
| 26 | 1622 | update | transfers | `cancelTransfer` — `status='cancelled'` | ✅ | ❌ | 🔴 | stock-moving |
| 27 | 2004 | insert | locations | `createLocation` | ✅ | ❌ (route GET-only) | 🟠 | |
| 28 | 2031 | update | locations | `updateLocation` | ✅ | ❌ | 🟠 | |
| 29 | 2054 | delete | locations | `deleteLocation` | ✅ | ❌ | 🟠 | |
| 30 | 2193 | insert | reservation_types | `createReservationType` | ✅ | ❌ | 🟢 | |
| 31 | 2222 | update | reservation_types | `updateReservationType` | ✅ | ❌ | 🟢 | |
| 32 | 2243 | delete | reservation_types | `deleteReservationType` | ✅ | ❌ | 🟢 | |
| 33 | 2307 | insert | uom_conversions | `createUomConversion` | ✅ | ❌ | 🟢 | |
| 34 | 2325 | delete | uom_conversions | `deleteUomConversion` | ✅ | ❌ | 🟢 | |
| 35 | 2699 | upsert | negative_inventory_config | `upsertNegativeInventoryConfig` | ✅ | ❌ | 🟠 | guardrail-adjacent policy |
| 36 | 2719 | delete | negative_inventory_config | `deleteNegativeInventoryConfig` | ✅ | ❌ | 🟠 | |
| 37 | 3061 | upsert | guardrail_policies | `upsertGuardrailPolicies` | ✅ | ❌ | 🟠 | controls negative-stock rules |

### `src/lib/rpc/supply-chain.ts` (7 writes)

| # | Line | Op | Table | Method | Event today | Route | Risk | Notes |
|---|------|----|-------|--------|-------------|-------|------|-------|
| 38 | 309 | update | vendors | `createVendor` — secondary write in create path | ✅ | ❌ | 🟠 | confirm intent |
| 39 | 329 | insert | vendors | `createVendor` | ✅ | ❌ (gv/vendors is the GV catalog, not this table) | 🟠 | |
| 40 | 354 | update | vendors | `updateVendor` (`safeUpdates`) | ✅ | ❌ | 🟠 | |
| 41 | 378 | update | vendors | `deleteVendor` — soft delete `active=false`, `nextEventId` | ✅ | ❌ | 🟠 | |
| 42 | 475 | insert | vendor_items | `createVendorItem` | ✅ | ✅ vendor-items POST | 🟢 | |
| 43 | 500 | update | vendor_items | `updateVendorItem` | ✅ | ❌ | 🟢 | |
| 44 | 523 | delete | vendor_items | `deleteVendorItem` | ✅ | ❌ | 🟢 | |

### `src/lib/api/purchase-orders.ts` (3 writes)

| # | Line | Op | Table | Method | Event today | Route | Risk | Notes |
|---|------|----|-------|--------|-------------|-------|------|-------|
| 45 | 520 | update | purchase_orders | `updatePurchaseOrderStatus` | ✅ | ❌ | 🔴 | financial; status drives PO lifecycle |
| 46 | 558 | update | purchase_orders | `deletePurchaseOrder` — soft delete `status='voided'` | ✅ | ❌ | 🔴 | financial |
| 47 | 615 | update | purchase_orders | `updatePurchaseOrder` — header edit | ✅ | ❌ | 🟠 | financial |

**Totals:** 47 writes — 13 insert, 24 update, 6 delete (soft+hard), 4 upsert.
No-event tables: `sku_settings` (#4, #9), `inventory_levels` (#12).
Fake-idempotency confirmed: #14 (`assignment_types`, `crypto.randomUUID()` per call).

---

## 2. Risk-ordered batches

Each batch is a reviewable/testable unit grouped by feature area.

**Batch 1 — Transfers (🔴 highest risk): #20–#26 (7 sites)**
Stock-moving, zero route coverage, and `updateTransfer`/`shipTransfer` are
multi-write (and looped) operations that must become **single transactional
routes** (or RPCs). Highest business risk + highest complexity. Do first while
attention is fresh; expect 2–3 new routes (`PATCH transfers/[id]`,
`transfers/[id]/ship`, `transfers/[id]/cancel`) likely wrapping existing RPCs.

**Batch 2 — Purchase orders + vendors (🔴/🟠 financial): #38–#41, #45–#47 (7 sites)**
PO status/void/edit (financial lifecycle) and vendor create/update/soft-delete.
No routes today. `purchasing` POST exists for create only.

**Batch 3 — Assets + assignment-types (🔴/🟠 + the fake-idempotency fix): #13–#19 (7 sites)**
Asset create/update/retire is inventory-critical; this batch also retires the
**#14 fake-idempotency** bug. `createAsset`'s secondary write (#16) needs intent
confirmation.

**Batch 4 — Catalog items + categories (🟠/🟢, partial routes exist): #1–#5, #10, #11 (7 sites)**
Some coverage already exists (items POST/PATCH, items/[id], categories POST), so
this is partly "route the gaps" (category update/delete, bulk reassign) and
partly "retire client writes that duplicate existing routes." Includes no-event
`sku_settings` delete (#4) riding inside `deleteItemCategory`.

**Batch 5 — Reference/type tables (🟢, all emit, no routes): #6–#8, #30–#34 (8 sites)**
location_types, reservation_types, uom_conversions. Low business risk, simple
CRUD, no transactional complexity — good "rhythm" batch. New CRUD routes.

**Batch 6 — Policy + no-event config (🟠, includes the no-event tables): #9, #12, #35–#37, #42–#44 (8 sites)**
`sku_settings` upsert (#9) and `inventory_levels` upsert (#12) are the **only two
no-event tables** — routing them is where you genuinely *add* an event that
didn't exist. Plus negative-inventory + guardrail policies and vendor_items
update/delete.

> Sequencing note: Batches 1–3 are risk-first as requested. If you'd rather build
> confidence on something low-stakes before the transfers gauntlet, Batch 5 is the
> safe warm-up — but per your "highest risk first" instruction the default order
> above leads with transfers.

---

## 3. Gotchas

**G1 — Double-emission (the big one).** 24 of the target tables already emit via
trigger. The existing routes (`items`, `categories`, `vendor-items`,
`purchasing`) *also* return `events:[]`, so they already emit twice (trigger +
route), often under different names (`catalog_item.created` from the route vs the
trigger's own event). **Decision required before batch 1:** for trigger-backed
tables, should new routes return `events: []` (empty — let the trigger be the
source of truth) or should we remove the triggers and let routes own emission?
CLAUDE.md flags empty `events:[]` as a *warning*, which nudges toward
route-owned emission — but that means dropping ~20 triggers. Pick one model and
apply it uniformly. This choice determines every route's `events` array.

**G2 — Multi-write methods must become transactional routes.**
`updateTransfer` (#20–23) does header + delete-lines + update-lines + insert-lines
as four separate client calls today (non-atomic — a failure mid-way leaves a
half-updated transfer). `shipTransfer` (#24–25) loops per-line updates then sets
the header. These must collapse into one route backed by a single RPC/transaction,
not a route that fires four sequential queries.

**G3 — No write routes exist for most tables.** Only catalog_items (#10,11,
create via items POST) and vendor_items-create (#42) and PO-create are genuinely
covered. ~40 sites need **new** routes built first. The HANDOFF-era "all routes
exist" claim was about a *different* set (alerts/cycle-counts); these data-layer
CRUD routes mostly don't exist.

**G4 — Signature mismatch: `lastEventId` vs `idempotencyKey`.** Several client
methods accept a `lastEventId` arg and write it into a `last_event_id` column
(#3, #10, #18, #19, #41). Routes instead receive `idempotencyKey` from the
chassis factory. When migrating, the client should stop generating event IDs and
let the route's idempotency guard own the key — otherwise you keep the
fake-idempotency pattern alive. Confirm nothing else reads that `last_event_id`
column as a business key.

**G5 — `safeUpdates` allowlisting moves server-side.** #16-adjacent update sites
use `...safeUpdates` (client-side column allowlist). The route must re-implement
that allowlist as a **zod schema** so the browser can no longer choose columns.
Don't just forward `req.json()`.

**G6 — Secondary writes in "create" paths (#16 createAsset, #38 createVendor).**
Each create method does an `update` before/after its `insert`. Confirm whether
that's a dedup/relink/upsert-by-code step before designing the route — it may
need `onConflict` handling rather than two operations.

**G7 — Behavior the UI depends on.** Client writes currently return the
`.select().single()` row immediately. Routes must return the same shape (the UI
reads `json.data`), and any optimistic-update code expecting synchronous DB
echo needs checking per call site.

**G8 — `gv/vendors` ≠ `supply_chain.vendors`.** The vendor *catalog* routes under
`gv/vendors` hit the Global Values project, not this service's
`supply_chain.vendors` table (#38–41). Don't mistake them for existing coverage.

---

## 4. Recommendation for Batch 1

**Do the Transfers cluster (#20–#26) first**, because it is simultaneously the
highest *business* risk (it moves physical stock), the highest *correctness* risk
(non-atomic multi-write today — G2), and has zero route coverage. Concretely:

1. **First, settle G1** (one decision, blocks everything): I recommend
   **route-owned emission** — new routes emit explicit `events:[]`, and we drop
   the corresponding table triggers as each table is migrated. It matches
   CLAUDE.md's contract and makes events greppable from the route. (Alternative:
   keep triggers, return `events:[]` empty, accept the scanner warning.)
2. Build/confirm transactional RPCs for update/ship/cancel transfer (several
   already exist — `shipTransfer`/`cancelTransfer` may already call RPCs for the
   stock math; verify before duplicating).
3. Add 3 routes: `PATCH /api/inventory/transfers/[id]`,
   `POST /api/inventory/transfers/[id]/ship`,
   `POST /api/inventory/transfers/[id]/cancel`, each wrapping one transaction,
   with zod validation and idempotency.
4. Repoint `InventoryRPC.updateTransfer/shipTransfer/cancelTransfer` at the routes;
   delete the direct writes.
5. Test the full create→update→ship→receive→cancel lifecycle before moving on.

If you'd prefer to validate the *route pattern itself* on something trivial
before betting it on stock movement, do **Batch 5** (reference tables) as a
throwaway pilot, then come back to transfers. Your call — but I wouldn't put
anything financial/stock-moving behind a pattern that hasn't been exercised once.

MIGRATION_PLAN_COMPLETE
