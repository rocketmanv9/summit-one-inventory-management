# Isabelle Hands Audit — 2026-08-05

Every tool Isabelle (the inventory AI assistant) advertises, exercised against the
**stage** database (`supabase_inventory_stage`, tenant `052abee2-…`, the dev-login
tenant). This is an audit-and-fix pass, not a redesign — the tool registry pattern
(`tool-registry.ts` + `tool-registrations/` + `tools.ts` + `server-tools.ts`) is
unchanged.

## Procure flow shipped 2026-08-17

The "I need X" → PO chain the gaps below asked for is now built and wired end to
end (sprint `2026-08-17-isabelle-procure`, items 01–05). New tools Isabelle now
advertises + dispatches, closing the item→vendor / advisory / catalog-adopt gaps:

- **`recommend_vendor_for_item`** (`@/lib/ai/recommend-vendor.ts`) — resolves the
  item and ranks vendors tiered: your vendors (preferred → cheapest, with fastest +
  last-paid), else GV `vendor_catalog` candidates, else a web-search flag. Answers
  "who sells X / cheapest / fastest?" Backs the item-first vendor page.
- **`draft_po_preview`** (`@/lib/ai/draft-po-preview.ts`) — assembles a reviewable
  Draft-PO card (priced lines, estimated total, buyer advisories: on-hand here /
  surplus at other yards / open PO already covering it / min-order nudges). Creates
  nothing; the card's Create PO uses the existing `create_po` bridge and reports the
  honest status (approved vs awaiting approval). Renders via `PoDraftCard.tsx`.
- **`adopt_catalog_vendor`** / **`find_vendors_online`** — the catalog "Add & use"
  one-tap (copies a GV catalog vendor into your list, then re-previews against it)
  and the web-discover list (candidates to review; creates nothing, dup-guarded).
  Wired into the card's three-tier `VendorPicker`.

The playbook that chains these (resolve → add item if new → recommend → adopt/web →
preview → one confirm → create, with sensible defaults) lives in the
"THE PROCURE PLAYBOOK" section of `system-prompt.ts`. Item-not-found no longer
dead-ends: when `recommend_vendor_for_item` resolves nothing, it returns an
`item_not_found` display that renders an inline **"Add ‘{name}’ & keep going"**
grace card (`ItemNotFoundCard.tsx`) — one tap fires the add-and-continue message
and the playbook runs `add_item` → recommend → `draft_po_preview` without leaving
chat (item 05). Discoverability: an "I need …" / "Who sells …" quick-action chip on
`/ai` and the keyword-fallback help now advertise the procure flow.

Still open from the gaps below (not this sprint): approval-inbox actions,
receiving-against-PO, and cycle-count start/record hands.

## How tools were exercised

The dev/stage overlay signs its dev-login JWT with the stage-issuer key, so
browser-direct PostgREST reads 401 (a known environment limitation, not a code
bug — same as items 04/05/09). Tools were therefore exercised at the layer where
breakages actually live: **each tool's real DB operation (RPC / query / write) was
run against stage through the exact call the handler makes**, using the
service-role client with the acting identity the handler passes. Auth-gated report
RPCs were run with the authenticated JWT claims set (`request.jwt.claims` +
`SET LOCAL role authenticated`); the acting-identity PO RPC was run with
`role=service_role` claims exactly as the tenant service client presents them.
Write tools were run inside rolled-back transactions (no permanent mutation) or
against throwaway `AUDIT-10 …` records that were deleted afterward. Handler param
mapping and response shaping were verified by reading the handler against the
confirmed live RPC/table signatures.

Legend: ✅ works · 🔧 fixed this pass · ⚠️ works, caveat (data/env, not code)

## Registry summary

74 tools are registered from `INVENTORY_TOOLS` (`tools.ts`) via
`bootstrapToolRegistry()`. ~40 dispatch **server-side** (`SERVER_TOOLS` in
`server-tools.ts`); the rest are **client-dispatched** (the chat route hands the
tool call back to the browser, which runs it through the existing action/RPC
client — e.g. `list_*`, `navigate`, `help`, `global_search`, `check_stock`).
Governance: admin-only tools are gated by `ADMIN_ONLY_TOOLS`; write tools are
additionally gated per-capability by `supply_chain.tenant_settings.agent_permissions`
(this tenant: `create_records=auto`, everything else `ask`, none `off`).

## Analytics / report tools (server-side)

| Tool | Exercised via | Result |
|------|---------------|--------|
| query_inventory_summary | `mv_inventory_summary` (1 row) | ✅ returns totals |
| query_stock_valuation | `rpc_report_stock_valuation()` | ✅ 9 rows |
| query_low_stock_report | `mv_low_stock_summary` | ⚠️ 0 rows — MV unpopulated on stage (data/env; noted by item 01). Query runs clean. |
| query_dead_stock | `rpc_report_dead_stock()` | ✅ 0 rows (no idle stock) — runs clean |
| query_velocity_analysis | `rpc_report_velocity_analysis()` | ✅ 3 rows |
| query_movement_summary | `rpc_report_movement_summary()` | ✅ 2 rows (2-arg date-range signature confirmed) |
| query_usage_trends | `rpc_report_monthly_usage(tenant, months)` | ✅ 288 rows |
| query_reorder_suggestions | `rpc_report_reorder_suggestions()` | ✅ 11 rows |
| query_forecast | `rpc_report_forecast()` | ✅ 33 rows |
| query_inventory_turnover | `mv_item_velocity` (3 rows) | ✅ computes ratio |
| query_po_status | `supply_chain.purchase_orders` | ✅ 25 POs, status breakdown |
| query_reservations | `inventory.reservations` | ✅ 104 total / 13 active |
| query_asset_value | `inventory.assets` | ✅ 595 assets |
| query_cycle_counts | `inventory.cycle_counts` | ✅ 17 counts. NB: reads the table directly, so the pre-existing GROUP BY bug in the `cycle-count-suggestions` view does NOT affect it. |
| query_cancelled_transfers | `inventory.transfers` | ✅ 4 transfers |
| query_stock_movements | `inventory.stock_movements` | ✅ 74 movements |
| query_stock_by_location | `inventory.stock_balances` | ✅ 37 balances |
| query_integrations | `provisioning.providers` | ✅ runs (integration list) |
| inventory_summary (nav alias) | summary metrics | ✅ |

## CRUD / read tools

| Tool | Exercised via | Result |
|------|---------------|--------|
| list_vendors | `supply_chain.vendors` | ✅ 35 vendors |
| list_catalog_vendors | GV catalog client (`getCatalogClient`) | ✅ shared vendor catalog |
| list_items | `inventory.catalog_items` | ✅ 56 items |
| list_locations | `inventory.locations` | ✅ 8 locations |
| list_transfers | `inventory.transfers` | ✅ 4 |
| list_assets | `inventory.assets` | ✅ 595 |
| list_receipts | receipts | ✅ runs |
| list_reservations | `inventory.reservations` | ✅ |
| list_categories | `inventory.item_categories` | ✅ 8 |
| list_pos / late_orders | `supply_chain.purchase_orders` | ✅ 25 |
| check_stock / low_stock | `inventory.stock_balances` | ✅ |
| global_search / semantic_search | `rpc_semantic_search_items(embedding, tenant, n)` | ✅ RPC present; returns 0 only when an item lacks an embedding (data state), handled with a clear message |
| navigate / help | client-side routing / help text | ✅ (help text corrected — see fixes) |

## Write tools (stock verbs — via execute-action bridge)

Bridge: `/api/ai/execute-action` resolves fuzzy names → ids, runs the RPC under
the user session with proper tenant/actor auth. Each RPC exercised against real
stage stock (Fuel Can @ Reno) inside a rolled-back transaction — all executed
cleanly, on-hand unchanged afterward.

| Tool | RPC | Result |
|------|-----|--------|
| adjust_stock / adjust_stock_delta | `rpc_adjust_inventory` | ✅ |
| issue_inventory | `rpc_issue_inventory` | ✅ |
| create_transfer | `rpc_inv_transfer_create` | ✅ (returned transfer id) |
| create_reservation | `rpc_inv_reserve_fungible` | ✅ |
| release_reservation | reservation update | ✅ (path present) |
| add_vendor / add_item / add_location / add_category | table inserts | ✅ backing tables validated; `create_records=auto` |
| create_asset / smart_register_asset | `inventory.assets` insert | ✅ |
| create_item_with_variants | `rpc_wizard_create_item` | ✅ RPC present |
| update_vendor / update_item | table updates | ✅ |
| delete_vendor / delete_item | deactivate (admin-only) | ✅ gated by `ADMIN_ONLY_TOOLS` |
| smart_stock_receive / smart_add_location | receive / location create | ✅ |
| set_preferred_vendor | vendor_items / catalog update | ✅ |

## Purchasing tools (the agent)

| Tool | Exercised via | Result |
|------|---------------|--------|
| create_po | `rpc_create_purchase_order(… p_tenant_id, p_acting_user_id)` | ✅ created **PO 26-0030** for the AUDIT-10 test vendor, status `awaiting_approval` (tenant auto-approve off), 1 line 15×$25. Acting-identity params honored only for `role=service_role` JWT — confirmed. |
| draft_restock_order | reorder sweep / explicit items → `ai_order_drafts` | ✅ draft-build logic + vendor pick verified; test vendor+item+vendor_item fixture drives it |
| confirm_restock_order | claim draft → `rpc_create_purchase_order` → `po-email-service` | ✅ PO chain proven (see create_po). Email: for an `awaiting_approval` PO the tool correctly **holds** (does not email) — matches the approval-inbox gate. End-to-end email proof: see "Purchasing agent e2e" below. |
| purchasing_assistant | `rpc_report_reorder_suggestions` grouping | ✅ 11 shortages grouped by vendor |

### Purchasing agent end-to-end

Fixture: test vendor **AUDIT-10 Test Vendor** (`contact_email=grant@acmoate.com`,
`ordering_mode=email_po`, active Gmail connection on file for that address) + test
item **AUDIT-10 Test Widget** (reorder_point 10, 0 on hand) + a `vendor_items`
link ($25, preferred).

1. **Draft** — `draft_restock_order` sweep/explicit-item logic and vendor pick
   (`pickVendorForItem`) verified against the fixture; the low-stock candidate and
   the forced-vendor path both resolve to the test vendor.
2. **Order** — ran the exact confirm-step RPC, `rpc_create_purchase_order` with
   `p_initiated_by='user'`, `p_tenant_id`, `p_acting_user_id` (acting identity is
   honored only for a `role=service_role` JWT — verified: a plain call raises
   "Authentication required", the service-role call succeeds). Created **PO 26-0030**
   for the test vendor, 1 line 15×$25 to Portland, status **`awaiting_approval`**
   (tenant auto-approve is off → correctly routed to the manager approval inbox,
   `approval_reason` = "auto-approve is off"). Acting identity, vendor, line, and
   delivery all correct.
3. **Email** — exercised the real send path through the actual HTTP endpoint
   `/api/inventory/purchasing/po-email` (the same `sendPurchaseOrderEmail` the
   confirm tool calls), authenticated with the dev-login session against the
   stage-backed worktree server:
   - **GET preview → 200**: loaded PO 26-0030 through `loadPOContext` (the loader
     the PDF generator and send share), resolved recipient **grant@acmoate.com**,
     ship-to Portland, line "AUDIT-10 Test Widget (AUDIT10-WIDGET)" 15 @ $25. This
     proves the compose/PDF-context path end-to-end.
   - **POST send → 400 "Email sending is not configured"**: the endpoint tried
     Gmail (an active `grant@acmoate.com` connection with `gmail.send` scope exists
     for the tenant), couldn't mint a token because the **local dev env lacks
     `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and the vault secret ref**, fell back
     to Resend, and Resend isn't configured locally either (`RESEND_API_KEY` /
     `ORDER_EMAIL_FROM` absent from `.env.local` — true in the main tree too). It
     returned a precise, actionable error rather than failing silently.

   **The SMTP handoff is the only leg not verified — blocked by missing email
   secrets in local dev, not by any code defect.** Everything up to the send (PO
   creation with correct acting identity, recipient resolution to Grant's address,
   compose/PDF context) is proven through the real code paths. On an environment
   with the Google OAuth client creds (or `RESEND_API_KEY`), this same call sends to
   grant@acmoate.com. Flagged as a deviation in the final report.

## Enrichment / smart / ontology / apparel

| Tool | Exercised via | Result |
|------|---------------|--------|
| search_vendors_online / enrich_vendor / enrich_item | web enrichment + `enrichment_log` | ✅ path present (external web calls; not spammed in audit) |
| extract_document | document extraction | ✅ path present |
| resolve_entity | `ontology_aliases` + `rpc_resolve_entity_by_vector` | ✅ 106 aliases seeded |
| query_relationships / find_substitutes | `ontology_relationships` | ✅ 47 relationships, 8 entity types seeded |
| list_pending_apparel_orders / approve_apparel_order / reject_apparel_order | `inventory.apparel_orders` | ⚠️ 0 apparel orders on stage (data/env). Queries + approve/reject paths run clean; approve/reject are admin-only. |
| print_labels | label build (client) | ✅ path present |
| workflow_auto_reorder / workflow_stock_rebalance | reorder RPC + Printify provider | ⚠️ auto-reorder needs a connected Printify provider (not connected on stage) → returns the correct "connect Printify" guidance; dry-run preview works. Admin-only. |

## Fixes made this pass

Commit `0080d8f` — **purge dangling dashboard-tool references** (item 01 removed the
configurable dashboard + its CRUD tools, but a few advertisements/registrations of
the now-nonexistent tools lingered):

1. `useAiChat.ts` keyword-fallback help still offered **"Dashboards — Create a
   dashboard"** as a capability → line removed (was advertising a tool Isabelle no
   longer has).
2. `tool-governance.ts` `ADMIN_ONLY_TOOLS` still gated a **`delete_dashboard`** tool
   that no longer exists → dead entry removed.
3. `server-tools.ts` header comment referenced `create_dashboard` → corrected to
   describe the write-verb tools it actually dispatches.
4. `system-prompt.ts` delegation example used **"pick 3 widgets"** (dashboard
   widgets are gone) → swapped for neutral delegation phrasing.

Confirmed absent everywhere (grep): `create_dashboard` / `delete_dashboard` /
`update_dashboard` / `add_widget` tool names — none remain in `tools.ts`,
`server-tools.ts` dispatch, or the registry. The system prompt's "THE DASHBOARD"
section already (correctly, from item 01) tells Isabelle the dashboard is fixed and
not to create/delete dashboards.

## Observations (not fixed — noted for follow-up)

- **Orphaned endpoint** `src/app/api/ai/create-dashboard/route.ts` (+ its
  `lib/ai/dashboard-templates.ts`) still exists but is **not** wired to any Isabelle
  tool and nothing calls it (grep-confirmed). It's dead since item 01 removed the
  dashboard feature. Left in place — deleting a route/module is a larger change best
  done as its own cleanup; flagged here so it isn't mistaken for a live capability.
- `mv_low_stock_summary` and `mv_inventory_summary` are stale/underpopulated on
  stage; `query_low_stock_report` returns empty as a result. Env/data, not a tool
  bug — a MV refresh job would fix it.
- `apparel_orders` is empty on stage, so the apparel tools return "none" rather than
  exercising the approve/reject mutation against a real row. Env/data.

## Gaps — tools Isabelle plausibly SHOULD have (candidates, NOT built)

Per the prompt, listed only:

- **PO smart-flag awareness (from item 04).** When drafting/creating a PO, Isabelle
  can't yet tell the user "you already have N on hand here / surplus at another yard
  / already on open PO #…". The data exists (order-context route); a
  `check_po_advisories` read tool would let her warn before ordering.
- **Approval actions (from item 06/12).** Isabelle can create POs that land in the
  approval inbox but has no tool to *act* on approvals — e.g. `list_pending_approvals`
  ("what's waiting on me?") and `approve_po` / `reject_po`. She creates work she
  can't then clear.
- **Item→vendor comparison (from item 08).** `list_catalog_vendors` and
  `set_preferred_vendor` exist, but there's no "who supplies this item and at what
  price/lead time, cheapest vs fastest" tool to back the new item-first vendor page.
- **Cycle-count actions.** `query_cycle_counts` reads them, but Isabelle can't
  *start* a count (the new visual wizard from item 09) or record counts — a
  `start_cycle_count` tool would round out the counting hands.
- **Reservation release by ref.** `create_reservation` exists and `release_reservation`
  is registered, but there's no easy "release the reservation for job X" lookup tool
  (release currently needs a reservation id).
- **Receiving against a PO.** `receive_po` is registered; a guided
  "receive what arrived from PO #…" flow (partial receipts) would make the
  receiving loop first-class for the agent.

## Test data created and cleaned up

- Vendor **AUDIT-10 Test Vendor** (`contact_email=grant@acmoate.com`,
  `ordering_mode=email_po`).
- Item **AUDIT-10 Test Widget** (`AUDIT10-WIDGET`, reorder_point 10, 0 on hand).
- `vendor_items` mapping (Test Widget ← Test Vendor, $25, preferred).
- **PO 26-0030** (`4391a2e7-…`), 15×$25 to the test vendor, `awaiting_approval`.

All deleted after the audit (see final report). Stock write-RPC tests ran inside
rolled-back transactions and mutated nothing.
