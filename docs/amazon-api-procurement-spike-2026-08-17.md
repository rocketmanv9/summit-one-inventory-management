# Amazon API procurement spike — findings

**Date:** 2026-08-17
**Sprint:** `2026-08-17-isabelle-procure`, item 06 (spike)
**Author:** build agent (grounded in stage code + `supabase_inventory_stage`)
**Deliverable:** this doc + three drafted follow-up prompts (`07`, `08`, `09`)

---

## TL;DR — the two questions

1. **"Can we manage inventory through Amazon's API?"** — **No, not today, and it is not a wiring gap — it is an account gap.** There is no Amazon API integration in the repo at all (no SP-API SDK, no Selling-Partner code, no `AMAZON_*`/`SPAPI_*` env vars). The entire live integration is **cXML punchout**. Everything Grant likely means by "manage inventory through the API" — catalog/price/availability lookup, order-history back-sync, returns — is **blocked on restoring SP-API / Amazon Business API access**, which is a business decision, not a build task. What IS buildable today rides on punchout. Lead with this reality; don't design against an API we can't call.

2. **"How do we control who can order through Amazon?"** — A gate already exists and is live: `supply_chain.amazon_purchaser_accounts` + `src/lib/amazon-access.ts`, enforced at `punchout/start`. But it is a **per-person registry** with **no `position_id`** — a second silo next to the repo's real position-based access systems (`position_capabilities` and buyable-groups). The recommended follow-up (prompt 07) **unifies** Amazon-PO authority with position-based access rather than growing the silo.

---

## 1. Current state (verified against code + stage DB)

### Mechanism: cXML punchout only. No Amazon API.
- Grep for `SPAPI|sellingpartner|aws-sdk|amazon-sp` across `src/` returns **zero SDK usage** — the only hits are prose in comments/UI copy (`src/lib/amazon-access.ts:18`, `src/lib/amazon-link.ts:18`, two UI pages). Confirmed no signed-API client exists.
- No `AMAZON_*` / `SPAPI_*` env vars. Connection state lives entirely in a **`provisioning.providers` row** (`provider_type='procurement_marketplace'`, `provider_key='amazon-business-main'`) with cXML credential **refs** into Vault (`from_identity_ref`, `shared_secret_ref`), resolved in `src/lib/integrations/amazon-business.ts:111` (`resolveCxmlCredentials`).
- **Stage DB state** (`supabase_inventory_stage`): 1 Amazon provider, `is_active=true`, `integration_mode='active'`, `sandbox=false`, all credential refs + PO URL present. 25 `punchout_orders`, 1 `provider_item_mappings`, 1 `amazon_purchaser_accounts` row, 4 `position_capabilities` rows.

### The hard constraint that makes direct API ordering impossible even conceptually
- Amazon's cXML `OrderRequest` **requires `SupplierPartAuxiliaryID` (SPAID)** per line — `src/lib/integrations/amazon-cxml.ts:244` throws if a line has no SPAID, and `:414` throws if a returned POOM item lacks one.
- **SPAID is only issued inside a returned punchout cart** (parsed at `amazon-cxml.ts:398`). So even with a restored API, **you cannot place an Amazon order programmatically without a punchout session first** — Amazon deliberately makes the shopper's cart the source of truth. The deprecated `placeOrder()` path (`amazon-business.ts:90`) exists only to throw and say exactly this.

### Punchout flow (all real / live)
| Stage | Route | Key behavior |
|---|---|---|
| **Start** | `POST .../amazon-business/punchout/start` (`start/route.ts:41`) | Gates via `assertCanPunchOut()` (`:52`); resolves catalog_item → ASIN from `supply_chain.vendor_items` where vendor `code='AMAZON-BIZ'`, `vendor_sku=ASIN` (`:111`); validates ship-to; builds `PunchOutSetupRequest`; POSTs to Amazon; writes `inventory.punchout_orders` status `punchout_started` (`:209`). Carries a Vercel protection-bypass token on the return URL (`:154`) — a cross-site form POST that would otherwise 401. |
| **Cart return** | `POST /api/webhooks/amazon-business/punchout-return` (`punchout-return/route.ts:190`) | Bare route (returns HTML the browser tab shows). Matches by `buyer_cookie` → `cart_returned` (`:262`). **Unmatched (Amazon-initiated) cart** → `captureAmazonInitiatedCart()` (`:69`) reverse-maps ASINs and creates a **DRAFT PO** via `rpc_create_po_from_punchout`. |
| **Submit** | `POST .../amazon-business/punchout/submit` (`submit/route.ts:29`) | Requires status `cart_returned` (`:46`); builds `OrderRequest` with SPAID from POOM; **spend-limit gate** (`resolve_spend_limit` `:177`; over limit → `awaiting_approval` + `resolve_po_approver`); POSTs to Amazon; marks PO `placed` (`:322`); reconciles PO lines to the actual cart (re-price / add / cancel, `:347`). |
| **Order confirmation (inbound)** | `POST /api/webhooks/amazon-business/order-confirmation` | HTTP-Basic auth → marks PO `acknowledged`, re-prices to Amazon total. |
| **Ship notice (inbound)** | `POST /api/webhooks/amazon-business/ship-notice` (`ship-notice/route.ts:28`) | HTTP-Basic auth; matches PO by `po_number`; fills `expected_delivery_date`; advances PO to `in_transit`; **appends carrier/tracking to `punchout_orders.metadata.shipments[]`** (`:83`). |

> **Correction to the pre-gathered planning notes:** the ship-notice route is **NOT a bare stub** — it authenticates, advances the PO to `in_transit`, and stores tracking. What it does **not** do is link that tracking into the **receiving / three-way-match** path (no `purchase_order_receipts` row, no receiving-line reconciliation). So the accurate framing is "tracking is captured but stranded in metadata," not "stubbed." That's a real, buildable gap (see prompt 09) — but describe it correctly.

### Item mapping (two layers, both written by paste-a-link)
- `provisioning.provider_item_mappings` — integration layer, `external_product_id`=ASIN (`amazon-link.ts:651`).
- `supply_chain.vendor_items` — vendor-price layer, `vendor_sku`=ASIN, Amazon vendor (`amazon-link.ts:691`). Vendor resolved by `ordering_mode='amazon_punchout'` first, name fallback (`findAmazonVendorId`, `:558`).
- Paste-a-link: `POST /api/inventory/amazon/resolve-link` → `/map-item`, logic in `src/lib/amazon-link.ts` (`resolveAmazonLink` `:415`, `saveAmazonMapping` `:618`). No SP-API — best-effort HTML scrape, ASIN-from-URL is the reliable signal.

### Purchaser gating ("who can buy on Amazon") — the seam for question 2
- Table `supply_chain.amazon_purchaser_accounts` (migration `20260814000007`). **Confirmed columns on stage:** `id, tenant_id, user_id, amazon_email, account_type, can_punch_out, notes, active, created_by, created_at, updated_at, last_event_id`. **There is no `position_id`.** It is strictly per-person.
- Gate logic `src/lib/amazon-access.ts`: **registry empty → dormant** (everyone allowed, `:104`); **non-empty → you need an active row with `can_punch_out=true`** (`:121-131`), admins included; **denial is soft** (403 with `code='amazon_purchaser_required'` + renderable copy, `:154`). A missing `userId` (service-to-service) is allowed (`:111`) — the registry gates people, and there's no person.
- Enforcement point today: **`punchout/start` only** (`start/route.ts:52`). `submit` re-checks the *spend limit* but not the *purchaser registry* (acceptable — you can't submit a cart you weren't allowed to start).
- Settings UI: `src/app/(dashboard)/settings/integrations/amazon/page.tsx`, fed by `GET .../amazon/overview` (`overview/route.ts:30`) which already joins each purchaser to their **`position_title`** and **`spending_limit`** — but only as read-only context (`overview/route.ts:98-99`). CRUD under `/api/settings/integrations/amazon/purchasers` (`purchasers/route.ts`), write-gated on `purchase_orders.manage` (`:42`).

### The *other* access systems this must reconcile with (don't create a third silo)
- **`position_capabilities`** (`public`): position → `capability_keys[]`. Resolved by `src/lib/access-server.ts:20` (`resolveUserCapabilities`), asserted by `assertCapability` (`:55`). Deny-by-default for configured positions; admin / no-position / unconfigured → full. `purchase_orders.manage` is the purchasing-admin key (4 positions grant it on stage).
- **Buyable-groups / buying-access** (`supply_chain.buyable_item_groups`, `buyable_item_group_items`, `buyable_item_person_links`; migration `20260810000005`): the position/person-based "what can this person buy, and through what fulfillment" system, surfaced at `/inventory/buying-access` and consumed at `/buyable-groups/mine`. Person links key on `hr_person_id`.
- **The mismatch to resolve:** buyable-groups and `position_capabilities` key on **position** (and HR person); `amazon_purchaser_accounts` keys on **`user_id`** with **no position awareness**. Unifying = let a position grant Amazon-punchout authority (so you don't hand-register every buyer), while keeping the per-person registry as the override/seat-email layer.

### RLS / the `app_metadata.tenant_id` gotcha (must honor in any new policy)
- Chassis session tokens put tenant in **`app_metadata.tenant_id`**, NOT a top-level `tenant_id` claim. `punchout_orders` RLS was silently returning zero rows for browser sessions until migration `20260814000008` fixed it; migration `20260814000009` then generalized it into `public.current_tenant_id()`, which coalesces the GUC → `app_metadata.tenant_id` → legacy `app_metadata.tenantId`. **Stage `punchout_orders` policy is now `tenant_id = current_tenant_id()`.** Any new tenant-scoped table/policy in a follow-up **must** use `current_tenant_id()` (or COALESCE the app_metadata path) — never a bare `request.jwt.claims ->> 'tenant_id'`.

---

## 2. Feasibility verdict per capability

Account status up front: **SP-API dev account intentionally lapsed ~2026-08-20; no API access today.** Anything below marked *blocked-on-account* stays out of scope until Grant restores access (his call).

| Capability Grant might want | Which Amazon API provides it | Buildable today? | Notes |
|---|---|---|---|
| **Item catalog lookup (title/image/category)** | SP-API Catalog Items API | **Blocked-on-account.** Today: best-effort HTML scrape via paste-a-link (`amazon-link.ts`) — an ASIN + whatever the page gives. | Scrape is degraded-by-design (Amazon blocks datacenter IPs). |
| **Live price** | SP-API Product Pricing API (or Business API `getListingOffers`) | **Blocked-on-account.** Today: price is whatever the buyer recorded or the last punchout cart returned. | The punchout cart return DOES carry real prices (POOM) — that's the honest "live price" we have. |
| **Availability / stock** | SP-API / Business API | **Blocked-on-account.** No availability signal today. | — |
| **Place an order programmatically** | — (impossible by design) | **Never, even with API restored,** without a punchout session — Amazon requires SPAID from a returned cart. | This is the load-bearing finding for "API-based ordering." |
| **Order placement (real)** | cXML punchout `OrderRequest` | **Works today** (`submit/route.ts`). | The supported path, full stop. |
| **Order-history / status back-sync** | SP-API Orders API | **Blocked-on-account** for a full pull. Today: inbound `order-confirmation` + `ship-notice` webhooks give per-order acknow/ship signals. | Webhooks cover the orders WE placed; no retroactive history. |
| **Shipment tracking** | (arrives via cXML ship-notice) | **Captured today** but stranded in `punchout_orders.metadata.shipments[]` — not linked to receiving. | Prompt 09 closes this. |
| **Returns** | SP-API | **Blocked-on-account.** | — |

**Cheapest path to each "want":** for ordering, punchout PO is already the cheapest and only real path. For price/availability, the cheapest signal we can get without SP-API is the **punchout cart return itself** (real POOM prices) plus the existing scrape — not a substitute for the API, but honest.

---

## 3. Recommended purchaser-gating model (question 2)

**Goal:** one coherent "who may create an Amazon PO" model, not two silos.

**Design:** keep `amazon_purchaser_accounts` as the **seat registry** (it holds the Amazon-side email + `can_punch_out` toggle, which is genuinely per-person), but make the **allow decision** also honor position:

- Extend `canUserPunchOut` (`amazon-access.ts:92`) so that, when the registry is non-empty, a user is allowed if **either** they have an active `can_punch_out` row **or** their position grants an Amazon-buying capability (new capability key, e.g. `amazon.punchout`, added to the `position_capabilities` catalog `src/lib/access.ts`). This preserves the existing dormant-when-empty and soft-denial semantics — it only *widens* who's allowed, so nothing that works today breaks.
- Surface both on the settings hub: `overview/route.ts` already resolves `position_title` per purchaser — add a "positions with Amazon buying" section so an admin can grant a whole position instead of registering each person.
- **Enforcement point stays `punchout/start`** (server, service-role client) — the one true gate. No new RLS needed for the decision itself; if a follow-up adds a position→capability mapping table it must use `current_tenant_id()` per the gotcha.
- Keep denials soft (renderable `amazon_purchaser_required` payload) so the UI copy stays intact.

This is **extend, not replace**: the registry table, the settings page, and the soft-denial contract all survive; we add a position path alongside them.

---

## 4. Isabelle tie-in (light)

The procure flow items 01–05 build (recommend vendor → `draft_po_preview` card → create PO) is **Amazon-blind today.** `draft-po-preview/route.ts` resolves vendor + lines + advisories but does **not** detect an Amazon vendor (`vendors.ordering_mode='amazon_punchout'`) and does **not** route to punchout — it assembles a normal PO preview. So if Isabelle recommends Amazon (an `AMAZON-BIZ` vendor exists on stage), the card would today try to create an ordinary PO, bypassing the punchout/SPAID requirement and the purchaser gate. The right shape (prompt 08): when the preview's chosen vendor is Amazon, the card returns a `fulfillment: 'amazon_punchout'` flag and its "Create" action **starts a punchout session** (respecting `assertCanPunchOut`) instead of calling `rpc_create_purchase_order` — so an Amazon-sourced line flows through the one real ordering path, gated correctly, rather than a parallel silo.

---

## 5. Risks / unknowns

- **`integration_mode='active'`, `sandbox=false` on stage** — the stage Amazon provider is pointed at *live* Amazon endpoints. Any follow-up that exercises `punchout/submit` end-to-end against stage could place a **real Amazon order.** Follow-ups must verify via the *start*/*preview* path or mocked cXML, never a live submit, unless Grant explicitly OKs it.
- **Restoring SP-API is Grant's business decision** — flagged, not assumed. All "blocked-on-account" items stay out of scope until then.
- **Capability-key sprawl** — adding `amazon.punchout` to the catalog must be additive; unconfigured positions already deny-by-default, so double-check the dormant-registry interaction (empty registry should stay "everyone allowed," even for positions without the new key).

---

## 6. Ranked recommendation — build order

1. **Prompt 07 — Unify Amazon purchaser gating with position-based access** (buildable now, highest leverage, closes the "second silo" concern). Ranked #1: it's pure gating logic + settings surface, no live-order risk, and it's the direct answer to question 2.
2. **Prompt 08 — Amazon-as-vendor in the Isabelle procure card** (buildable now, connects this sprint's hero flow to the real ordering path; depends conceptually on 07's gate). Ranked #2: medium size, must respect the live-submit risk (route to *start*, human finishes on Amazon).
3. **Prompt 09 — Link Amazon ship-notice tracking into receiving/three-way-match** (buildable now, closes the "tracking stranded in metadata" gap). Ranked #3: smallest, self-contained, no Amazon-account dependency.
4. **(No prompt) SP-API availability/price lookup feeding item 01's recommender** — **blocked-on-account, explicitly out of scope.** *What it'd take if restored:* re-enroll the SP-API dev account, add a Selling-Partner client + LWA token refresh, wire Catalog Items + Product Pricing calls behind the existing `findAmazonVendorId`/`vendor_items` seam so the recommender can show live Amazon price/availability. Do not draft this until Grant restores access.
