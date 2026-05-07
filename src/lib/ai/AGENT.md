# Isabelle — AI Inventory Agent

## Architecture

```
User → Chat UI → /api/ai/chat (POST) → OpenAI (gpt-4.1) → Tool Calls
                                              ↓
                              Server Tools (executed in-route)
                                              ↓
                              Supabase (tenant-scoped via RLS)
                                              ↓
                              Tool Result → OpenAI → NL Summary → User
```

- **Chat route**: `src/app/api/ai/chat/route.ts` — up to 5 server tool rounds per request
- **Tool definitions**: `src/lib/ai/tools.ts` — OpenAI function-calling schemas
- **Tool handlers**: `src/lib/ai/server-tools.ts` — server-side execution
- **Intent classification**: `src/lib/ai/types.ts` — READ / MUTATION / ANALYTICS / WORKFLOW
- **System prompt**: `src/lib/ai/system-prompt.ts` — personality and behavioral rules
- **Search provider**: `src/lib/ai/search-provider.ts` — web search abstraction

## Tool Registry

### Read-Only (client-side)
`list_vendors`, `list_items`, `check_stock`, `low_stock`, `list_pos`, `late_orders`, `list_locations`, `list_transfers`, `list_assets`, `list_receipts`, `list_reservations`, `list_categories`, `global_search`, `inventory_summary`, `navigate`

### Analytics (server-side, read-only)
`query_inventory_summary`, `query_stock_valuation`, `query_low_stock_report`, `query_dead_stock`, `query_velocity_analysis`, `query_movement_summary`, `query_reorder_suggestions`, `query_forecast`, `query_inventory_turnover`, `query_po_status`

### Dashboard (server-side, writes DB)
`create_dashboard`, `list_dashboards`, `list_available_widgets`, `add_dashboard_widget`, `remove_dashboard_widget`, `update_dashboard`, `delete_dashboard`

### Mutation (client-side, requires user confirmation)
`add_vendor`, `update_vendor`, `delete_vendor`, `add_item`, `update_item`, `delete_item`, `adjust_stock`, `issue_inventory`, `create_transfer`, `create_asset`, `add_location`, `add_category`, `create_reservation`, `release_reservation`, `create_po`

### Smart/Workflow (server-side)
`smart_stock_receive`, `smart_add_location`, `smart_register_asset`, `search_vendors_online`, `set_preferred_vendor`, `workflow_auto_reorder`, `workflow_stock_rebalance`

### Enrichment & Intelligence (server-side)
| Tool | Writes DB | Description |
|------|-----------|-------------|
| `enrich_vendor` | enrichment_log only | Web-search vendor, show diff, user confirms |
| `enrich_item` | enrichment_log only | AI-suggest fields, show diff, user confirms |
| `query_reservations` | No | Smart filtered reservation queries |
| `query_asset_value` | No | Total fleet value with breakdown |
| `draft_purchase_request` | No | Generate RFQ email draft (not sent) |
| `extract_document` | No | Extract line items from invoice/receipt image |

## Required Environment Variables

| Variable | Required | Used By |
|----------|----------|---------|
| `OPENAI_API_KEY` | Yes | All AI features, enrichment, search |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Database access |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Tenant-scoped service client |
| `INTERNAL_JWT_ISSUER` | No | Service name for tracing |
| `TAVILY_API_KEY` | No | Future alternative search provider |

## Enrichment Log

Table: `inventory.enrichment_log`

Tracks all enrichment attempts with:
- `entity_type` (vendor/item/asset) + `entity_id`
- `fields_suggested` JSONB: `{ field: { current, suggested, confidence } }`
- `fields_applied` JSONB (set when user accepts)
- `status`: suggested → applied / rejected / partial
- `provider`, `source_url`, `confidence`

## Debugging Failed Tool Calls

1. Check server logs: `console` output from the chat route
2. Check `inventory.enrichment_log` for enrichment failures
3. Verify `OPENAI_API_KEY` is set for AI-dependent tools
4. Check Supabase RLS policies if queries return empty
5. Run `npx vitest run tests/ai-agent.test.ts` for unit tests
