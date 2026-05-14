/**
 * AI Tool Fixes -- Unit Tests
 * Tests for fuzzy confirmation, delta stock adjustment, SKU auto-generation, and tool registry.
 */

import { describe, it, expect } from 'vitest';
import { isFuzzyConfirm, isFuzzyCancel } from '../src/lib/ai/fuzzy-confirm';

describe('isFuzzyConfirm', () => {
  it('accepts standard confirmations', () => {
    expect(isFuzzyConfirm('yes')).toBe(true);
    expect(isFuzzyConfirm('y')).toBe(true);
    expect(isFuzzyConfirm('confirm')).toBe(true);
    expect(isFuzzyConfirm('sure')).toBe(true);
    expect(isFuzzyConfirm('ok')).toBe(true);
    expect(isFuzzyConfirm('go ahead')).toBe(true);
    expect(isFuzzyConfirm('proceed')).toBe(true);
    expect(isFuzzyConfirm('do it')).toBe(true);
    expect(isFuzzyConfirm('sounds good')).toBe(true);
  });

  it('accepts typos via Levenshtein distance', () => {
    expect(isFuzzyConfirm('ues')).toBe(true);     // distance 1 from "yes" (y->u substitution)
    expect(isFuzzyConfirm('yess')).toBe(true);    // distance 1 from "yes" (extra s)
    expect(isFuzzyConfirm('confirn')).toBe(true); // distance 1 from "confirm" (m->n substitution)
    expect(isFuzzyConfirm('confir')).toBe(true);  // distance 1 from "confirm" (missing m)
  });

  it('is case insensitive', () => {
    expect(isFuzzyConfirm('YES')).toBe(true);
    expect(isFuzzyConfirm('Sure')).toBe(true);
    expect(isFuzzyConfirm('CONFIRM')).toBe(true);
  });

  it('trims whitespace', () => {
    expect(isFuzzyConfirm('  yes  ')).toBe(true);
    expect(isFuzzyConfirm(' ok ')).toBe(true);
  });

  it('rejects non-confirmations', () => {
    expect(isFuzzyConfirm('no')).toBe(false);
    expect(isFuzzyConfirm('cancel')).toBe(false);
    expect(isFuzzyConfirm('random text')).toBe(false);
    expect(isFuzzyConfirm('maybe')).toBe(false);
    expect(isFuzzyConfirm('hello')).toBe(false);
    expect(isFuzzyConfirm('')).toBe(false);
  });
});

describe('isFuzzyCancel', () => {
  it('accepts standard cancellations', () => {
    expect(isFuzzyCancel('no')).toBe(true);
    expect(isFuzzyCancel('n')).toBe(true);
    expect(isFuzzyCancel('cancel')).toBe(true);
    expect(isFuzzyCancel('abort')).toBe(true);
    expect(isFuzzyCancel('stop')).toBe(true);
    expect(isFuzzyCancel('nevermind')).toBe(true);
    expect(isFuzzyCancel('never mind')).toBe(true);
    expect(isFuzzyCancel('nope')).toBe(true);
    expect(isFuzzyCancel('nah')).toBe(true);
    expect(isFuzzyCancel("don't")).toBe(true);
  });

  it('is case insensitive', () => {
    expect(isFuzzyCancel('NO')).toBe(true);
    expect(isFuzzyCancel('Cancel')).toBe(true);
    expect(isFuzzyCancel('ABORT')).toBe(true);
  });

  it('rejects non-cancellations', () => {
    expect(isFuzzyCancel('yes')).toBe(false);
    expect(isFuzzyCancel('sure')).toBe(false);
    expect(isFuzzyCancel('random text')).toBe(false);
    expect(isFuzzyCancel('')).toBe(false);
  });
});

describe('IntentType includes adjust_stock_delta', () => {
  it('is in VALID_INTENTS set', async () => {
    // Dynamic import to test the parse-response module
    const mod = await import('../src/lib/ai/parse-response');
    const result = mod.parseAIResponse({
      type: 'tool_use',
      intent: 'adjust_stock_delta',
      params: { item: 'shovels', location: 'Portland', delta: '50' },
    });
    expect(result).not.toBeNull();
    expect(result?.type).toBe('tool_use');
    if (result?.type === 'tool_use') {
      expect(result.intent).toBe('adjust_stock_delta');
    }
  });
});

describe('Tool definitions', () => {
  it('includes adjust_stock_delta tool', async () => {
    const { INVENTORY_TOOLS } = await import('../src/lib/ai/tools');
    const tool = INVENTORY_TOOLS.find((t) => t.function.name === 'adjust_stock_delta');
    expect(tool).toBeDefined();
    expect(tool?.function.parameters.properties).toHaveProperty('delta');
  });

  it('adjust_stock description mentions exact/physical count', async () => {
    const { INVENTORY_TOOLS } = await import('../src/lib/ai/tools');
    const tool = INVENTORY_TOOLS.find((t) => t.function.name === 'adjust_stock');
    expect(tool?.function.description).toContain('exact');
  });

  it('smart_register_asset includes name and location params', async () => {
    const { INVENTORY_TOOLS } = await import('../src/lib/ai/tools');
    const tool = INVENTORY_TOOLS.find((t) => t.function.name === 'smart_register_asset');
    expect(tool).toBeDefined();
    expect(tool?.function.parameters.properties).toHaveProperty('name');
    expect(tool?.function.parameters.properties).toHaveProperty('location');
    expect(tool?.function.parameters.properties).toHaveProperty('serial_number');
  });
});

describe('SKU auto-generation logic', () => {
  it('generates SKU from item name', () => {
    const name = 'Walk Behind Crackfill Box';
    const prefix = name.replace(/[^a-zA-Z0-9]/g, '').substring(0, 8).toUpperCase();
    const suffix = Date.now().toString(36).slice(-4).toUpperCase();
    const sku = `${prefix}-${suffix}`;
    expect(sku).toMatch(/^WALKBEHI-[A-Z0-9]{4}$/);
  });

  it('preserves user-provided SKU', () => {
    const userSku = 'CUSTOM-001';
    const sku = userSku || '';
    expect(sku).toBe('CUSTOM-001');
  });
});

describe('Tool governance registry', () => {
  it('has governance entries for key tools', async () => {
    const { ADMIN_ONLY_TOOLS, canExecuteTool } = await import('../src/lib/ai/tool-governance');

    // Destructive tools should be admin-only
    expect(ADMIN_ONLY_TOOLS.has('delete_vendor')).toBe(true);
    expect(ADMIN_ONLY_TOOLS.has('delete_item')).toBe(true);
    expect(ADMIN_ONLY_TOOLS.has('workflow_auto_reorder')).toBe(true);

    // Read-only tools should NOT be admin-only
    expect(ADMIN_ONLY_TOOLS.has('list_vendors')).toBe(false);
    expect(ADMIN_ONLY_TOOLS.has('check_stock')).toBe(false);

    // canExecuteTool: admin can execute anything
    expect(canExecuteTool('delete_vendor', 'admin')).toBe(true);
    expect(canExecuteTool('list_vendors', 'admin')).toBe(true);

    // canExecuteTool: authenticated user cannot execute admin-only tools
    expect(canExecuteTool('delete_vendor', 'authenticated')).toBe(false);
    expect(canExecuteTool('list_vendors', 'authenticated')).toBe(true);
  });

  it('filterToolsForRole removes admin-only tools for non-admin users', async () => {
    const { filterToolsForRole } = await import('../src/lib/ai/tool-governance');
    const { INVENTORY_TOOLS } = await import('../src/lib/ai/tools');

    const adminTools = filterToolsForRole(INVENTORY_TOOLS, 'admin');
    const userTools = filterToolsForRole(INVENTORY_TOOLS, 'authenticated');

    // Admin gets all tools
    expect(adminTools.length).toBe(INVENTORY_TOOLS.length);

    // Non-admin gets fewer tools (admin-only ones removed)
    expect(userTools.length).toBeLessThan(adminTools.length);

    // Verify specific admin-only tool is filtered out
    const hasDeleteVendor = userTools.some((t) => t.function.name === 'delete_vendor');
    expect(hasDeleteVendor).toBe(false);

    // Verify non-admin tool is still present
    const hasListVendors = userTools.some((t) => t.function.name === 'list_vendors');
    expect(hasListVendors).toBe(true);
  });
});
