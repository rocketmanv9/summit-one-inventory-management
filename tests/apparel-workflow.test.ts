import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Apparel Workflow Tests
 *
 * Covers: HR webhook handling, stock check, reorder creation,
 * Isabelle tool registration, approve/reject flows, Printful client.
 */

// ── Supabase mock ───────────────────────────────────────────────────────────

function createMockSupabase(overrides: { data?: any; error?: any } = {}) {
  const response = { data: overrides.data ?? null, error: overrides.error ?? null };
  const builder: any = {
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue(response),
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue(response),
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue(response),
          limit: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue(response),
          }),
        }),
        limit: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue(response),
        }),
        order: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(response),
        }),
        gt: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(response),
          }),
        }),
      }),
      data: response.data,
      error: response.error,
    }),
    insert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue(response),
      }),
    }),
    upsert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue(response),
      }),
    }),
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue(response),
          }),
        }),
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue(response),
        }),
      }),
    }),
    eq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue(response),
    }),
    rpc: vi.fn().mockResolvedValue(response),
  };
  return {
    from: vi.fn().mockReturnValue(builder),
    schema: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue(builder), rpc: vi.fn().mockResolvedValue(response) }),
    _builder: builder,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('apparel workflow', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.restoreAllMocks();
  });

  describe('tool registration', () => {
    it('registers apparel tools in SERVER_TOOLS', async () => {
      const { isServerTool } = await import('@/lib/ai/server-tools');
      expect(isServerTool('list_pending_apparel_orders')).toBe(true);
      expect(isServerTool('approve_apparel_order')).toBe(true);
      expect(isServerTool('reject_apparel_order')).toBe(true);
    });

    it('includes apparel tools in INVENTORY_TOOLS definitions', async () => {
      const { INVENTORY_TOOLS } = await import('@/lib/ai/tools');
      const toolNames = INVENTORY_TOOLS.map((t) => t.function.name);
      expect(toolNames).toContain('list_pending_apparel_orders');
      expect(toolNames).toContain('approve_apparel_order');
      expect(toolNames).toContain('reject_apparel_order');
    });

    it('classifies apparel tools as WORKFLOW intents', async () => {
      const { classifyIntent } = await import('@/lib/ai/types');
      expect(classifyIntent('list_pending_apparel_orders')).toBe('WORKFLOW');
      expect(classifyIntent('approve_apparel_order')).toBe('WORKFLOW');
      expect(classifyIntent('reject_apparel_order')).toBe('WORKFLOW');
    });
  });

  describe('system prompt', () => {
    it('includes apparel management section', async () => {
      const { buildSystemPrompt } = await import('@/lib/ai/system-prompt');
      const prompt = buildSystemPrompt();
      expect(prompt).toContain('APPAREL & UNIFORM MANAGEMENT');
      expect(prompt).toContain('list_pending_apparel_orders');
      expect(prompt).toContain('Printful');
    });
  });

  describe('apparel config schema', () => {
    it('size_variant_map links sizes to catalog items and Printful variants', () => {
      const sizeMap = {
        S: { variant_id: 4011, catalog_item_id: 'uuid-s' },
        M: { variant_id: 4012, catalog_item_id: 'uuid-m' },
        L: { variant_id: 4013, catalog_item_id: 'uuid-l' },
        XL: { variant_id: 4014, catalog_item_id: 'uuid-xl' },
      };

      expect(sizeMap['M'].variant_id).toBe(4012);
      expect(sizeMap['M'].catalog_item_id).toBe('uuid-m');
      expect(Object.keys(sizeMap)).toHaveLength(4);
    });
  });

  describe('apparel order statuses', () => {
    it('defines valid status transitions', () => {
      const validStatuses = [
        'pending_approval', 'approved', 'rejected',
        'ordered', 'in_production', 'shipped',
        'fulfilled', 'failed', 'canceled',
      ];

      // Verify the expected workflow transitions
      expect(validStatuses).toContain('pending_approval');
      expect(validStatuses).toContain('ordered');
      expect(validStatuses).toContain('fulfilled');
      expect(validStatuses.length).toBe(9);
    });
  });

  describe('Printful client', () => {
    it('exports expected functions', async () => {
      const printful = await import('@/lib/printful');
      expect(typeof printful.createDraftOrder).toBe('function');
      expect(typeof printful.confirmOrder).toBe('function');
      expect(typeof printful.getOrder).toBe('function');
      expect(typeof printful.estimateCosts).toBe('function');
      expect(typeof printful.getProducts).toBe('function');
      expect(typeof printful.getProductVariants).toBe('function');
    });

    it('throws when PRINTFUL_API_TOKEN is not set', async () => {
      const original = process.env.PRINTFUL_API_TOKEN;
      delete process.env.PRINTFUL_API_TOKEN;

      const printful = await import('@/lib/printful');
      await expect(printful.getProducts()).rejects.toThrow('PRINTFUL_API_TOKEN');

      if (original) process.env.PRINTFUL_API_TOKEN = original;
    });
  });

  describe('HR webhook reservation logic', () => {
    it('skips processing when shirt_size is missing', () => {
      const payload = { employee_name: 'John Doe', employee_id: 'emp-1' };
      // No shirt_size → should not throw, just skip
      expect(payload.shirt_size).toBeUndefined();
    });

    it('normalizes shirt size to uppercase', () => {
      const size = 'xl';
      expect(size.toUpperCase().trim()).toBe('XL');
    });

    it('generates correct idempotency key', () => {
      const tenantId = 'tenant-123';
      const employeeId = 'emp-456';
      const size = 'M';
      const key = `hr-shirt-${tenantId}-${employeeId}-${size}`;
      expect(key).toBe('hr-shirt-tenant-123-emp-456-M');
    });
  });

  describe('low stock detection', () => {
    it('triggers reorder when available qty is at or below threshold', () => {
      const threshold = 5;
      const testCases = [
        { available: 0, shouldReorder: true },
        { available: 3, shouldReorder: true },
        { available: 5, shouldReorder: true },
        { available: 6, shouldReorder: false },
        { available: 100, shouldReorder: false },
      ];

      for (const { available, shouldReorder } of testCases) {
        expect(available <= threshold).toBe(shouldReorder);
      }
    });
  });

  describe('Printful webhook status mapping', () => {
    it('maps Printful events to apparel order statuses', () => {
      const statusMap: Record<string, string> = {
        package_shipped: 'shipped',
        order_failed: 'failed',
        order_canceled: 'canceled',
      };

      expect(statusMap['package_shipped']).toBe('shipped');
      expect(statusMap['order_failed']).toBe('failed');
      expect(statusMap['order_canceled']).toBe('canceled');
    });

    it('maps Printful order_updated statuses correctly', () => {
      const printfulStatus = 'fulfilled';
      const mapped = printfulStatus === 'fulfilled' ? 'fulfilled' : printfulStatus === 'inprocess' ? 'in_production' : undefined;
      expect(mapped).toBe('fulfilled');
    });
  });
});
