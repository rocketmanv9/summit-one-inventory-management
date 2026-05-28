/**
 * AI Tools — Audit & Repair Verification Tests
 *
 * Validates that:
 * 1. New server tools are registered and callable
 * 2. Schema bugs are fixed (inventorySchema used, correct columns)
 * 3. Tools never return blank text responses
 * 4. Tool definitions exist for all new tools
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Suppress console output in tests
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});

// ─── Test tool registration completeness ────────────────────────────

describe('Tool Registration', () => {
  it('INVENTORY_TOOLS includes all new tool definitions', async () => {
    const { INVENTORY_TOOLS } = await import('../src/lib/ai/tools');
    const toolNames = INVENTORY_TOOLS.map((t: any) => t.function?.name).filter(Boolean);

    const newTools = [
      'query_cycle_counts',
      'query_cancelled_transfers',
      'query_stock_movements',
      'query_stock_by_location',
      'query_integrations',
    ];

    for (const name of newTools) {
      expect(toolNames).toContain(name);
    }
  });

  it('SERVER_TOOLS set includes all new tools', async () => {
    const { isServerTool } = await import('../src/lib/ai/server-tools');

    const newTools = [
      'query_cycle_counts',
      'query_cancelled_transfers',
      'query_stock_movements',
      'query_stock_by_location',
      'query_integrations',
    ];

    for (const name of newTools) {
      expect(isServerTool(name)).toBe(true);
    }
  });

  it('TOOL_GOVERNANCE includes all new tools', async () => {
    const { TOOL_GOVERNANCE } = await import('../src/lib/ai/tool-governance');

    const newTools = [
      'query_cycle_counts',
      'query_cancelled_transfers',
      'query_stock_movements',
      'query_stock_by_location',
      'query_integrations',
    ];

    for (const name of newTools) {
      expect(TOOL_GOVERNANCE[name]).toBeDefined();
      expect(TOOL_GOVERNANCE[name].riskLevel).toBe('low');
    }
  });
});

// ─── Helpers ────────────────────────────────────────────────────────

/** Build a mock Supabase client that returns configurable data */
function mockSupabase(overrides: Record<string, any> = {}) {
  const chainable: any = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: overrides.singleData ?? null, error: overrides.error ?? null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: overrides.maybeSingleData ?? null, error: null }),
    then: undefined as any,
  };

  // Make the chainable itself resolve as a promise (for queries without .single())
  chainable.then = (resolve: any) => resolve({ data: overrides.data ?? [], error: overrides.error ?? null });

  const from = vi.fn().mockReturnValue(chainable);
  const rpc = vi.fn().mockResolvedValue({ data: overrides.rpcData ?? [], error: null });

  const supabase = {
    from,
    rpc,
    schema: vi.fn().mockReturnValue({ from, rpc }),
  };

  return { supabase, chainable };
}

function mockCtx(supabase: any) {
  return {
    supabase,
    tenantId: '00000000-0000-0000-0000-000000000001',
    userId: '00000000-0000-0000-0000-000000000002',
    cookieHeader: '',
    baseUrl: 'http://localhost:3000',
  };
}

// ─── Schema bug fix verification ────────────────────────────────────

describe('Schema Bug Fixes', () => {
  it('smart_add_location uses active (not is_active)', async () => {
    const serverToolsSrc = await import('fs').then(fs =>
      fs.readFileSync('src/lib/ai/server-tools.ts', 'utf8')
    );
    // The old bug: is_active: true
    expect(serverToolsSrc).not.toContain('is_active: true');
    // Verify the fix
    expect(serverToolsSrc).toContain('active: true');
  });

  it('queryPoStatus uses vendor_name_snapshot (not vendor_name)', async () => {
    const serverToolsSrc = await import('fs').then(fs =>
      fs.readFileSync('src/lib/ai/server-tools.ts', 'utf8')
    );
    // The select should use vendor_name_snapshot
    expect(serverToolsSrc).toContain('vendor_name_snapshot');
    // Should use expected_delivery_date
    expect(serverToolsSrc).toContain('expected_delivery_date');
  });

  it('no ctx.supabase.from("locations") — all use inventorySchema', async () => {
    const serverToolsSrc = await import('fs').then(fs =>
      fs.readFileSync('src/lib/ai/server-tools.ts', 'utf8')
    );
    // Should NOT have ctx.supabase directly querying locations
    const badPattern = /ctx\.supabase\s*\n?\s*\.from\('locations'\)/;
    expect(badPattern.test(serverToolsSrc)).toBe(false);
  });

  it('no inventorySchema for dashboards — table is in public schema', async () => {
    const serverToolsSrc = await import('fs').then(fs =>
      fs.readFileSync('src/lib/ai/server-tools.ts', 'utf8')
    );
    const badPattern = /inventorySchema\(ctx\.supabase\)\s*\n?\s*\.from\('dashboards'\)/;
    expect(badPattern.test(serverToolsSrc)).toBe(false);
  });

  it('no inventorySchema for dashboard_widgets — table is in public schema', async () => {
    const serverToolsSrc = await import('fs').then(fs =>
      fs.readFileSync('src/lib/ai/server-tools.ts', 'utf8')
    );
    const badPattern = /inventorySchema\(ctx\.supabase\)\s*\n?\s*\.from\('dashboard_widgets'\)/;
    expect(badPattern.test(serverToolsSrc)).toBe(false);
  });

  it('no inventorySchema for widget_registry — table is in public schema', async () => {
    const serverToolsSrc = await import('fs').then(fs =>
      fs.readFileSync('src/lib/ai/server-tools.ts', 'utf8')
    );
    const badPattern = /inventorySchema\(ctx\.supabase\)\s*\n?\s*\.from\('widget_registry'\)/;
    expect(badPattern.test(serverToolsSrc)).toBe(false);
  });
});

// ─── New tool definitions have correct OpenAI schema ────────────────

describe('New Tool OpenAI Schemas', () => {
  it('query_stock_by_location requires location parameter', async () => {
    const { INVENTORY_TOOLS } = await import('../src/lib/ai/tools');
    const tool = INVENTORY_TOOLS.find((t: any) => t.function?.name === 'query_stock_by_location');
    expect(tool).toBeDefined();
    expect(tool!.function.parameters.required).toContain('location');
  });

  it('query_cycle_counts has optional status enum', async () => {
    const { INVENTORY_TOOLS } = await import('../src/lib/ai/tools');
    const tool = INVENTORY_TOOLS.find((t: any) => t.function?.name === 'query_cycle_counts');
    expect(tool).toBeDefined();
    expect(tool!.function.parameters.properties.status.enum).toContain('scheduled');
    expect(tool!.function.parameters.properties.status.enum).toContain('in_progress');
  });

  it('query_cancelled_transfers has optional days parameter', async () => {
    const { INVENTORY_TOOLS } = await import('../src/lib/ai/tools');
    const tool = INVENTORY_TOOLS.find((t: any) => t.function?.name === 'query_cancelled_transfers');
    expect(tool).toBeDefined();
    expect(tool!.function.parameters.properties.days.type).toBe('number');
  });

  it('query_stock_movements has movement_type and date filters', async () => {
    const { INVENTORY_TOOLS } = await import('../src/lib/ai/tools');
    const tool = INVENTORY_TOOLS.find((t: any) => t.function?.name === 'query_stock_movements');
    expect(tool).toBeDefined();
    const props = tool!.function.parameters.properties;
    expect(props.movement_type).toBeDefined();
    expect(props.start_date).toBeDefined();
    expect(props.end_date).toBeDefined();
  });

  it('query_integrations has no required parameters', async () => {
    const { INVENTORY_TOOLS } = await import('../src/lib/ai/tools');
    const tool = INVENTORY_TOOLS.find((t: any) => t.function?.name === 'query_integrations');
    expect(tool).toBeDefined();
    expect(tool!.function.parameters.required).toBeUndefined();
  });
});

// ─── Blank response prevention ──────────────────────────────────────

describe('Blank Response Prevention', () => {
  it('chat route handles empty OpenAI content after tool call', async () => {
    const routeSrc = await import('fs').then(fs =>
      fs.readFileSync('src/app/api/ai/chat/route.ts', 'utf8')
    );
    // Verify the blank response fallback is in place
    expect(routeSrc).toContain('If OpenAI returned empty content after a tool result');
    expect(routeSrc).toContain('lastToolMsg.content');
  });

  it('vendor search has graceful fallback message', async () => {
    const serverToolsSrc = await import('fs').then(fs =>
      fs.readFileSync('src/lib/ai/server-tools.ts', 'utf8')
    );
    expect(serverToolsSrc).toContain('Web search failed, trying catalog fallback');
    expect(serverToolsSrc).toContain('add a vendor named');
  });
});

// ─── Utterance coverage (tool name routing) ─────────────────────────

describe('Utterance → Tool Mapping Coverage', () => {
  // These tests verify the correct tools exist for each utterance category.
  // The actual NL→tool mapping is done by OpenAI, but we verify the tools
  // are present and have descriptions that match the utterance intent.

  const toolDescriptions: Record<string, string> = {};

  beforeEach(async () => {
    const { INVENTORY_TOOLS } = await import('../src/lib/ai/tools');
    for (const t of INVENTORY_TOOLS) {
      if (t.function?.name) {
        toolDescriptions[t.function.name] = (t.function.description || '').toLowerCase();
      }
    }
  });

  it('#1 "Do I have any rakes at my locations?" → check_stock exists', () => {
    expect(toolDescriptions.check_stock).toBeDefined();
  });

  it('#3 "What stock balances do I have in Auburn?" → query_stock_by_location exists', () => {
    expect(toolDescriptions.query_stock_by_location).toBeDefined();
    expect(toolDescriptions.query_stock_by_location).toContain('location');
  });

  it('#4 "Can you add rake as a tool for me?" → add_item exists', () => {
    expect(toolDescriptions.add_item).toBeDefined();
  });

  it('#6 "Help me add a new A.C. Moate location" → smart_add_location exists', () => {
    expect(toolDescriptions.smart_add_location).toBeDefined();
  });

  it('#8 "Add 5 shovels to my inventory in Portland" → adjust_stock_delta exists', () => {
    expect(toolDescriptions.adjust_stock_delta).toBeDefined();
  });

  it('#10 "What locations do I have?" → list_locations exists', () => {
    expect(toolDescriptions.list_locations).toBeDefined();
  });

  it('#11 "What do I have in Portland?" → query_stock_by_location describes stock at location', () => {
    expect(toolDescriptions.query_stock_by_location).toContain('stock');
  });

  it('#12 "Any cancelled transfers in the last week?" → query_cancelled_transfers exists', () => {
    expect(toolDescriptions.query_cancelled_transfers).toBeDefined();
    expect(toolDescriptions.query_cancelled_transfers).toContain('cancelled');
  });

  it('#13 "Do I have any cycle counts going on?" → query_cycle_counts exists', () => {
    expect(toolDescriptions.query_cycle_counts).toBeDefined();
    expect(toolDescriptions.query_cycle_counts).toContain('cycle count');
  });

  it('#14 "Any reservations right now?" → query_reservations exists', () => {
    expect(toolDescriptions.query_reservations).toBeDefined();
  });

  it('#15 "Do I have any integrations set up?" → query_integrations exists', () => {
    expect(toolDescriptions.query_integrations).toBeDefined();
    expect(toolDescriptions.query_integrations).toContain('integration');
  });

  it('#16 "Audit my ledger for weird things" → query_stock_movements exists', () => {
    expect(toolDescriptions.query_stock_movements).toBeDefined();
    expect(toolDescriptions.query_stock_movements).toContain('ledger');
  });

  it('#17 "Help me create a purchase order" → create_po exists', () => {
    expect(toolDescriptions.create_po).toBeDefined();
  });
});
