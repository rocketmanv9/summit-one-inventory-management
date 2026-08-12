# Isabelle — AI Inventory Agent

## Architecture

```
User → Chat UI → /api/ai/chat (POST) → OpenAI → Tool Calls
                                            ↓
                    ┌───────────────────────┴───────────────────────┐
                    ▼                                                ▼
          SERVER tool (executed in-route)              CLIENT tool (tool_call SSE event)
                    ↓                                                ↓
          server-tools.ts → Supabase (RLS)            useAiChat.ts → intent → action flow
                    ↓                                                ↓
          data_result → OpenAI → NL summary           confirm card / modal → RPC write
```

- **Chat route**: `src/app/api/ai/chat/route.ts` — up to 5 server-tool rounds per request. Server tools run inline and feed results back to OpenAI; client tools are returned to the browser as a `tool_call` event for the intent/action flow to execute.
- **Tool definitions**: `src/lib/ai/tools.ts` — `INVENTORY_TOOLS`, the OpenAI function-calling schemas. **Single source of truth** for the tool surface.
- **Server handlers**: `src/lib/ai/server-tools.ts` — `SERVER_TOOLS` set + `executeServerToolInner` switch.
- **Registry**: `src/lib/ai/tool-registry.ts` + `tool-registrations/index.ts` — tags, governance, execution mode (auto-bootstrapped on import).
- **Intent gate**: `src/lib/ai/parse-response.ts` — `VALID_INTENTS` is derived from `INVENTORY_TOOLS` (no hand-maintained list to drift).
- **Classification**: `src/lib/ai/types.ts` — READ / MUTATION / ANALYTICS / WORKFLOW.
- **System prompt**: `src/lib/ai/system-prompt.ts` — personality + behavioral rules.

> **Wiring guard:** `tests/ai-tool-wiring.test.ts` iterates the whole registry and fails CI if any tool is half-wired (missing tag/governance, no server switch case, rejected by the intent gate, orphan handler, or capability-gated without a definition). This catalog is verified against that test — keep them in sync.

## Tool Catalog (79 tools)

`Mode` = where the tool executes (`server` in the chat route, or `client` via the intent/action flow). `Role` = `admin` if restricted via `ADMIN_ONLY_TOOLS`, otherwise available to all authenticated users.

#### crud (32)
| Tool | Mode | Role | Description |
|------|------|------|-------------|
| `add_vendor` | client | — | Create a new vendor/supplier (searches the web for contact details). |
| `update_vendor` | client | — | Update an existing vendor's details. |
| `delete_vendor` | client | admin | Delete/deactivate a vendor. |
| `list_vendors` | client | — | List the tenant's active vendors. |
| `list_catalog_vendors` | server | — | Browse the global/shared vendor catalog available to adopt. |
| `add_item` | client | — | Create a catalog item (category auto-matched or created). |
| `delete_item` | client | admin | Delete a catalog item. |
| `update_item` | client | — | Update a catalog item's details. |
| `list_items` | client | — | List all catalog items. |
| `create_item_with_variants` | server | — | Create a parent item with size/color/etc. variant children. |
| `adjust_stock` | server | — | Set stock to an exact quantity (physical count). |
| `adjust_stock_delta` | server | — | Add/subtract a relative quantity from current stock. |
| `check_stock` | client | — | Check current stock levels for an item or all items. |
| `low_stock` | client | — | List items below their minimum stock level. |
| `issue_inventory` | server | — | Issue/release inventory to a job, truck, or person. |
| `create_po` | server | — | Create a draft purchase order, optionally with line items. |
| `list_pos` | client | — | List purchase orders. |
| `late_orders` | client | — | List late/overdue purchase orders. |
| `list_locations` | client | — | List locations (warehouses, yards, job sites). |
| `add_location` | client | — | Create a location. |
| `create_transfer` | server | — | Create a stock transfer between two locations. |
| `list_transfers` | client | — | List recent stock transfers. |
| `create_asset` | client | — | Register a serialized asset (equipment, vehicle, tool). |
| `list_assets` | client | — | List registered assets (optional location/status filters). |
| `print_labels` | client | — | Prepare barcode/QR labels for assets (optional location/status filters) and open the print dialog preloaded. |
| `list_receipts` | client | — | List recent receiving receipts. |
| `create_reservation` | server | — | Reserve stock at a location for a job/truck/etc. |
| `release_reservation` | client | — | Release/cancel an active reservation. |
| `list_reservations` | client | — | List active reservations. |
| `receive_po` | client | — | Navigate to the receiving workflow for a PO. |
| `list_categories` | client | — | List item categories. |
| `add_category` | client | — | Create an item category. |

#### analytics (19)
| Tool | Mode | Role | Description |
|------|------|------|-------------|
| `inventory_summary` | client | — | Overview of inventory status (SKUs, items, locations, alerts). |
| `query_inventory_summary` | server | — | High-level KPIs: on hand, reserved, available, alert counts. |
| `query_stock_valuation` | server | — | Inventory value by location and category. |
| `query_low_stock_report` | server | — | Items below minimum with shortage amounts. |
| `query_dead_stock` | server | — | Idle items with days-since-movement and capital locked. |
| `query_velocity_analysis` | server | — | 30/60/90-day usage velocity and days-of-stock. |
| `query_movement_summary` | server | — | Movement totals by type over a date range. |
| `query_usage_trends` | server | — | Month-by-month consumption history for seasonal patterns. |
| `query_reorder_suggestions` | server | — | Recommended reorder quantities + preferred vendor. |
| `query_forecast` | server | — | On-hand vs reserved vs incoming vs demand net position. |
| `query_inventory_turnover` | server | — | Turnover ratio and velocity metrics. |
| `query_po_status` | server | — | PO status summary (open / late / completed). |
| `query_reservations` | server | — | Smart-filtered reservation queries (NL dates, person, asset). |
| `query_asset_value` | server | — | Total asset/fleet value with breakdown. |
| `query_cycle_counts` | server | — | Cycle-count (physical audit) status. |
| `query_cancelled_transfers` | server | — | Recently cancelled transfers. |
| `query_stock_movements` | server | — | The stock-movement ledger (ins/outs). |
| `query_stock_by_location` | server | — | All stock balances at a specific location. |
| `query_integrations` | server | — | Configured integrations and tool settings. |

#### workflow (4)
| Tool | Mode | Role | Description |
|------|------|------|-------------|
| `workflow_auto_reorder` | server | admin | Draft POs for all below-reorder items (dry-run by default). |
| `workflow_stock_rebalance` | server | admin | Suggest transfers to balance stock (dry-run by default). |
| `draft_purchase_request` | server | — | Generate an RFQ/purchase-request email draft (not sent). |
| `purchasing_assistant` | server | — | Detect shortages → preferred vendors → grouped draft POs. |

#### smart (4)
| Tool | Mode | Role | Description |
|------|------|------|-------------|
| `smart_stock_receive` | server | — | Find/create item + location and add stock (photo-friendly). |
| `smart_add_location` | server | — | Create a location with address validation + type matching. |
| `smart_register_asset` | server | — | Register an asset from a natural-language description. |
| `extract_document` | server | — | Extract line items from an invoice/receipt/packing-slip image (no write). |

#### enrichment (4)
| Tool | Mode | Role | Description |
|------|------|------|-------------|
| `search_vendors_online` | server | — | Web-search for suppliers of a product/service in an area. |
| `set_preferred_vendor` | server | — | Link a vendor as preferred supplier for an item (with pricing). |
| `enrich_vendor` | server | — | Web-source vendor fields, show a diff (writes `enrichment_log` only). |
| `enrich_item` | server | — | AI-suggest item fields, show a diff (writes `enrichment_log` only). |

#### search (2)
| Tool | Mode | Role | Description |
|------|------|------|-------------|
| `global_search` | client | — | Search across all entities (items, assets, vendors, POs…). |
| `semantic_search` | server | — | Natural-language item search by meaning (vector). |

#### ontology (3)
| Tool | Mode | Role | Description |
|------|------|------|-------------|
| `resolve_entity` | server | — | Resolve free text to a canonical entity (exact → alias → vector). |
| `query_relationships` | server | — | All ontology relationships for an entity. |
| `find_substitutes` | server | — | Substitute items / alternatives for an entity. |

#### apparel (3)
| Tool | Mode | Role | Description |
|------|------|------|-------------|
| `list_pending_apparel_orders` | server | — | Pending uniform/apparel orders awaiting approval. |
| `approve_apparel_order` | server | admin | Approve a pending apparel order and place it with Printful. |
| `reject_apparel_order` | server | admin | Reject a pending apparel order. |

#### navigation (1)
| Tool | Mode | Role | Description |
|------|------|------|-------------|
| `navigate` | client | — | Navigate to a page in the app. |

## Agent Permissions (Settings → Assistant)

Tools that perform inventory writes are gated by a per-tenant capability the user
controls in Settings, each set to **off / ask / auto** (stored in
`supply_chain.tenant_settings.agent_permissions`; see migration
`20260615000003_agent_permissions.sql`). The mapping lives in `TOOL_CAPABILITY`
in `server-tools.ts`:

| Capability | Settings label | Tools |
|------------|----------------|-------|
| `stock_adjust` | stock adjustments | `adjust_stock`, `adjust_stock_delta` |
| `stock_issue` | issuing stock | `issue_inventory` |
| `transfer` | stock transfers | `create_transfer` |
| `reserve` | reservations | `create_reservation`, `release_reservation` |
| `create_records` | creating records | `add_vendor`, `add_item`, `add_location`, `add_category`, `create_asset`, `smart_add_location`, `smart_register_asset`, `create_item_with_variants` |
| `purchase_orders` | purchase orders | `create_po` |

Behavior per level:
- **off** — Isabelle refuses up front (universal kill-switch in `executeServerTool`).
- **ask** — returns a preview ("Ready to … Confirm and I'll do it") and waits for confirmation (default).
- **auto** — executes immediately without a confirm step.

Server-side write tools (`adjust_stock`, `issue_inventory`, `create_transfer`,
`create_reservation`, `create_po`) POST to `/api/ai/execute-action` so the
mutation runs under the user's session (proper tenant/actor auth + outbox events).

## Honest-Failure Contract

`executeServerTool` wraps every handler in a try/catch that surfaces failures to
the user ("I ran into a problem running X…") instead of letting a thrown DB error
be summarized by the model as a confident-but-empty answer. Primary data fetches
use `unwrap()` so a Postgres error throws rather than reporting empty data as success.

## Required Environment Variables

| Variable | Required | Used By |
|----------|----------|---------|
| `OPENAI_API_KEY` | Yes | All AI features, enrichment, search (absent → keyword fallback) |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Database access |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Tenant-scoped service client |
| `INTERNAL_JWT_ISSUER` | No | Service name for tracing |
| `TAVILY_API_KEY` | No | Alternative web-search provider |

## Enrichment Log

Table: `inventory.enrichment_log` — tracks enrichment attempts:
- `entity_type` (vendor/item/asset) + `entity_id`
- `fields_suggested` JSONB: `{ field: { current, suggested, confidence } }`
- `fields_applied` JSONB (set when the user accepts)
- `status`: suggested → applied / rejected / partial
- `provider`, `source_url`, `confidence`

## Debugging Failed Tool Calls

1. Check server logs — `[AI Chat]` and `[server-tools]` console output from the chat route.
2. Run `npx vitest run tests/ai-tool-wiring.test.ts` — confirms every tool is wired end-to-end.
3. Run `npx vitest run tests/ai-tool-deps.test.ts` — confirms every RPC/table a tool calls exists in the schema snapshot.
4. Check `inventory.enrichment_log` for enrichment failures.
5. Verify `OPENAI_API_KEY` is set for AI-dependent tools.
6. Check Supabase RLS policies if queries return empty.
7. Run `npx vitest run tests/ai-agent.test.ts` for behavioral unit tests.
