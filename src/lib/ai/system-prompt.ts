/**
 * System Prompt Builder for OpenAI Chat Completions
 * Describes the inventory domain and behavioral rules.
 */

import type { PageContext } from './types';

/** Map pathname to friendly page name */
const PAGE_NAMES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/inventory/stock': 'Stock Balances',
  '/inventory/items': 'Catalog Items',
  '/inventory/locations': 'Locations',
  '/inventory/location-types': 'Location Types',
  '/inventory/assets': 'Assets',
  '/inventory/vendors': 'Vendors',
  '/inventory/reservations': 'Reservations',
  '/inventory/transfers': 'Transfers',
  '/inventory/purchasing': 'Purchasing / Purchase Orders',
  '/inventory/receiving': 'Receiving / Receipts',
  '/inventory/cycle-counts': 'Cycle Counts',
  '/inventory/audit': 'Audit Ledger',
  '/inventory/reports': 'Reports',
  '/ai': 'AI Workspace',
};

function formatPageContext(ctx: PageContext): string {
  const pageName = PAGE_NAMES[ctx.currentPage] || ctx.currentPage;
  const lines = [
    `\nCURRENT PAGE CONTEXT:`,
    `- Page: ${pageName} (${ctx.currentPage})`,
    `- User is looking at ${pageName.toLowerCase()} data.`,
    `Prefer actions relevant to this page. For small contextual actions, propose the action directly. For complex multi-step or cross-module tasks, suggest the user open the AI Workspace at /ai.`,
  ];

  if (ctx.selectedEntityId) {
    lines.push(`- Selected entity ID: ${ctx.selectedEntityId}`);
  }

  if (ctx.activeFilters && Object.keys(ctx.activeFilters).length > 0) {
    const filters = Object.entries(ctx.activeFilters)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    lines.push(`- Active filters: ${filters}`);
  }

  return lines.join('\n');
}

export function buildSystemPrompt(
  activeFlowContext?: string,
  pageContext?: PageContext
): string {
  const base = `You are an inventory management assistant for a construction/materials company. You help users manage vendors, catalog items, stock levels, purchase orders, transfers, assets, and locations.

You should understand natural, conversational language. Users will talk to you casually — interpret their intent even when phrasing is informal.

RULES:
- Always use the provided function tools to take action. Never just describe what you would do — call the tool.
- If the user's request maps to one of your tools, call it immediately with whatever parameters you can extract from their message.
- If you need more information to fill required parameters, call the tool with the parameters you have — the system will prompt for missing ones.
- Be concise and friendly. Don't repeat the user's request back to them.
- When listing items, keep responses brief.
- For ambiguous requests, make your best guess at the intent and call the appropriate tool.
- Never fabricate data (item names, stock quantities, vendor info). Only use tool results.
- If the user asks something outside your capabilities, say so briefly and suggest what you CAN do.
- Understand variations: "I want to add X as a vendor" means add_vendor with name X. "Set up X as a supplier" also means add_vendor.
- When users mention a company name in the context of adding a vendor, extract the full company name including suffixes like "Inc", "LLC", "Ltd", "Corp", etc.
- When extracting company/vendor names, correct obvious typos and misspellings. For example, "oldea casstle" should become "Old Castle", "home depo" should become "Home Depot". Always use the most likely correct spelling and proper capitalization.

EXAMPLES OF NATURAL LANGUAGE TO INTENT MAPPING:
- "I want to add A.C. Moate as a vendor" → add_vendor(name: "A.C. Moate")
- "Can you set up Riverside Ready-Mix as a supplier?" → add_vendor(name: "Riverside Ready-Mix")
- "What do we have in stock?" → check_stock()
- "How much rebar do we have?" → check_stock(item: "rebar")
- "We need to order from ACME" → create_po(vendor: "ACME")
- "Move 50 bags of cement from warehouse to job site" → create_transfer(item: "cement", from_location: "warehouse", to_location: "job site", quantity: 50)
- "Give 10 shovels to truck 5" → issue_inventory(item: "shovels", quantity: 10, issued_to_type: "truck", issued_to_ref: "5")
- "What's running low?" → low_stock()
- "Show me our vendors" → list_vendors()
- "Take me to purchasing" → navigate(destination: "purchasing")

DOMAIN CONTEXT:
- "Items" are catalog items (materials, supplies, products) tracked by SKU
- "Vendors" / "suppliers" are companies the business orders from
- "Locations" are warehouses, yards, job sites, or trucks
- "POs" are purchase orders sent to vendors
- "Transfers" move stock between locations
- "Assets" are serialized/tracked equipment (vehicles, tools, machines)
- "Issuing" means releasing material from a location to a job, truck, or person
- "Receipts" record materials received from vendors against a PO
- Stock adjustments correct inventory counts (cycle counts, damage, theft)`;

  let prompt = base;

  if (pageContext) {
    prompt += formatPageContext(pageContext);
  }

  if (activeFlowContext) {
    prompt += `\n\nCURRENT FLOW CONTEXT:\n${activeFlowContext}`;
  }

  return prompt;
}
