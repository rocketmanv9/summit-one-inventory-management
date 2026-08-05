# AI Tool Orchestration -- Developer Guide

This directory contains the AI chat assistant (Isabelle) tool orchestration layer.

## Architecture

```
User message -> useAiChat.ts -> OpenAI API -> parseAIResponse -> tool dispatch
                                                                    |
                                              +---------------------+------------------+
                                              v                     v                  v
                                    Client-side MUTATION   Server-side ANALYTICS   Server-side WORKFLOW
                                    (actions.ts)           (server-tools.ts)       (server-tools.ts)
```

### Tool Types

| Type | Executed On | Examples | Handler |
|------|------------|---------|---------|
| MUTATION | Client (browser) | adjust_stock, add_item, create_transfer | `actions.ts` -> `getActionDefinition()` |
| READ | Client (browser) | list_vendors, check_stock, low_stock | `actions.ts` -> `getActionDefinition()` |
| ANALYTICS | Server (API route) | query_inventory_summary, query_forecast | `server-tools.ts` -> `executeServerTool()` |
| WORKFLOW | Server (API route) | workflow_auto_reorder, smart_register_asset | `server-tools.ts` -> `executeServerTool()` |

## Adding a New Tool -- Checklist

1. **`src/lib/ai/tools.ts`** -- Add OpenAI function definition. This is the single source of truth — `VALID_INTENTS` in `parse-response.ts` is derived from it automatically, so there is no separate list to keep in sync.
2. **`src/lib/chat/intents.ts`** -- Add to `IntentType` union (TypeScript type only)
3. **For SERVER tools** -- Add to the `SERVER_TOOLS` set AND a `case` in `executeServerToolInner`'s switch in `src/lib/ai/server-tools.ts`
4. **For CLIENT tools** -- Add a `case` in `getActionDefinition()` in `src/lib/chat/actions.ts`
5. **`src/lib/ai/tool-registrations/index.ts`** -- Add to `TAG_MAP` (≥1 tag; the wiring test fails otherwise)
6. **`src/lib/ai/useAiChat.ts`** -- Add to `AI_PARAM_MAP` and `SMART_DEFAULTS` (client tools)
7. **`src/lib/ai/executeAction.ts`** -- Add title in `intentToTitle()`
8. **`src/lib/ai/types.ts`** -- Add to appropriate classification set (READ/ANALYTICS/WORKFLOW or default MUTATION)
9. **`src/lib/ai/tool-governance.ts`** -- Add to `ADMIN_ONLY_TOOLS` if destructive; add to `TOOL_CAPABILITY` in `server-tools.ts` if it should respect the Settings → Assistant on/ask/auto gate
10. **`src/lib/ai/system-prompt.ts`** -- Add usage examples and rules

> **Wiring guard:** `tests/ai-tool-wiring.test.ts` iterates the whole registry and fails CI if any tool is half-wired (missing tag/governance, no server switch case, rejected by the intent gate, or capability-gated without a definition). Run `npx vitest run tests/ai-tool-wiring.test.ts` after adding a tool.

## Confirmation Rules

- **Fuzzy matching** (`fuzzy-confirm.ts`): Accepts typos (Levenshtein distance <= 1 from "yes"/"confirm"), casual phrasing ("sure", "go ahead", "sounds good")
- **Ambiguous input**: Re-prompts instead of cancelling
- **Cancel restore**: After cancellation, "I meant yes" / "actually yes" restores the cancelled flow
- **Governance override**: Tools in `ADMIN_ONLY_TOOLS` in `tool-governance.ts` require admin role, even when all params are pre-filled by the AI

## Stock Adjustment: Delta vs Absolute

| Tool | Use When | Example |
|------|---------|---------|
| `adjust_stock` | Setting exact quantity (physical count) | "count shows 90", "set to 100" |
| `adjust_stock_delta` | Adding/removing relative quantity | "add 50 more", "lost 5", "remove 10" |

Delta adjustment computes: `newQty = currentQty + delta`, guards against negative results, and shows math in confirmation.

## Error Contract

```ts
interface ToolError {
  code: 'missing_param' | 'not_found' | 'validation' | 'conflict' | 'upstream' | 'internal';
  message: string;
  missingFields?: string[];
  suggestions?: string[];
}
```

Server-side tools surface specific error messages (e.g., "A location named X already exists" for unique constraint violations) instead of generic "Creation failed".

## Read-After-Write

Read-after-write tools (see `readAfterWrite` in `tool-governance.ts`) re-query after a mutation to verify persistence and fold the fresh state into the response.

## Tool Governance

Tools are governed by role-based access control via `tool-governance.ts`:

- **`ADMIN_ONLY_TOOLS`** -- Set of tool names that require admin role (e.g., `delete_vendor`, `delete_item`, `workflow_auto_reorder`)
- **`filterToolsForRole(tools, role)`** -- Filters OpenAI tool definitions based on user role; admin gets all tools, non-admin gets tools minus `ADMIN_ONLY_TOOLS`
- **`canExecuteTool(toolName, role)`** -- Server-side guard to check if a tool can be executed by the given role
- **`resolveUserRole(supabase, userId, tenantId)`** -- Resolves user role from the `local_users` table

High-risk tools (deletions, workflow automation, order approvals) are restricted to admin users. Read-only tools (list_vendors, check_stock) are available to all authenticated users.
