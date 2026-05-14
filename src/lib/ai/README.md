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
| WORKFLOW | Server (API route) | create_dashboard, smart_register_asset | `server-tools.ts` -> `executeServerTool()` |

## Adding a New Tool -- Checklist

1. **`src/lib/ai/tools.ts`** -- Add OpenAI function definition
2. **`src/lib/chat/intents.ts`** -- Add to `IntentType` union
3. **`src/lib/ai/parse-response.ts`** -- Add to `VALID_INTENTS` set
4. **`src/lib/chat/actions.ts`** -- Add `case` in `getActionDefinition()` (for client-side tools)
5. **`src/lib/ai/useAiChat.ts`** -- Add to `AI_PARAM_MAP` and `SMART_DEFAULTS`
6. **`src/lib/ai/executeAction.ts`** -- Add title in `intentToTitle()`
7. **`src/lib/ai/types.ts`** -- Add to appropriate classification set (READ/ANALYTICS/WORKFLOW or default MUTATION)
8. **`src/lib/ai/tool-governance.ts`** -- Add to `ADMIN_ONLY_TOOLS` if destructive
9. **`src/lib/ai/system-prompt.ts`** -- Add usage examples and rules

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

Dashboard mutations (add/remove widget, update dashboard) re-query after write to verify persistence and include counts in response: "Added widget X (now 5 widgets)".

## Tool Governance

Tools are governed by role-based access control via `tool-governance.ts`:

- **`ADMIN_ONLY_TOOLS`** -- Set of tool names that require admin role (e.g., `delete_vendor`, `delete_item`, `workflow_auto_reorder`)
- **`filterToolsForRole(tools, role)`** -- Filters OpenAI tool definitions based on user role; admin gets all tools, non-admin gets tools minus `ADMIN_ONLY_TOOLS`
- **`canExecuteTool(toolName, role)`** -- Server-side guard to check if a tool can be executed by the given role
- **`resolveUserRole(supabase, userId, tenantId)`** -- Resolves user role from the `local_users` table

High-risk tools (deletions, workflow automation, order approvals) are restricted to admin users. Read-only tools (list_vendors, check_stock) are available to all authenticated users.
