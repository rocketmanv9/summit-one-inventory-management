import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.spyOn(console, 'log').mockImplementation(() => {});

// Mock the provider registry
vi.mock('../../src/lib/provisioning/providers/registry', () => ({
  getProvider: vi.fn(),
  registerProvider: vi.fn(),
}));

// Mock printify (prevents self-registration side effect)
vi.mock('../../src/lib/provisioning/providers/printify', () => ({}));

// Mock chassis
vi.mock('@rocketmanv9/chassis/supabase', () => ({
  createTenantServiceClient: vi.fn(),
}));

// Mock admin client
vi.mock('../../src/utils/supabase/admin', () => ({
  getAdminClient: vi.fn(),
}));

import { getProvider } from '../../src/lib/provisioning/providers/registry';
import { executeExternalOrder, type ExternalOrderContext } from '../../src/lib/provisioning/external-order';

function createMockSupabase(overrides: Record<string, any> = {}) {
  const chainable: any = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    ...overrides,
  };
  const mockSchema = vi.fn().mockReturnValue(chainable);
  return { schema: mockSchema, _chainable: chainable } as any;
}

function baseCtx(overrides: Partial<ExternalOrderContext> = {}): ExternalOrderContext {
  return {
    tenantId: 'tenant-1',
    requestId: 'req-1',
    line: {
      id: 'line-1',
      catalog_item_id: 'cat-1',
      qty: 2,
      fulfillment_method: 'external_order',
      provider_id: 'prov-1',
      external_order_id: null,
      submit_attempt_count: 0,
    },
    shippingAddress: {
      name: 'John Doe',
      address1: '123 Main St',
      city: 'Denver',
      state: 'CO',
      zip: '80202',
      country: 'US',
    },
    idempotencyKey: 'idem-1',
    ...overrides,
  };
}

describe('executeExternalOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns no-op when external_order_id is already set', async () => {
    const supabase = createMockSupabase();
    const ctx = baseCtx({
      line: {
        ...baseCtx().line,
        external_order_id: 'existing-order-123',
      },
    });

    const result = await executeExternalOrder(supabase, ctx);

    expect(result.success).toBe(true);
    expect(result.events).toHaveLength(0);
    // Should not have queried any tables
    expect(supabase._chainable.from).not.toHaveBeenCalled();
  });

  it('places order successfully and sets external_order_id', async () => {
    const mockPlaceOrder = vi.fn().mockResolvedValue({
      success: true,
      externalOrderId: 'ext-order-456',
    });
    (getProvider as any).mockReturnValue({
      providerType: 'print_on_demand',
      placeOrder: mockPlaceOrder,
    });

    let singleCallCount = 0;
    const supabase = createMockSupabase({
      single: vi.fn().mockImplementation(() => {
        singleCallCount++;
        if (singleCallCount === 1) {
          // Provider record
          return Promise.resolve({
            data: { id: 'prov-1', provider_type: 'print_on_demand', config: { shop_id: 'shop-1' } },
            error: null,
          });
        }
        if (singleCallCount === 2) {
          // Provider item mapping
          return Promise.resolve({
            data: { external_product_id: 'prod-1', external_variant_id: 'var-1' },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      }),
    });

    const ctx = baseCtx();
    const result = await executeExternalOrder(supabase, ctx);

    expect(result.success).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].event_name).toBe('provision_line.ordered');
    expect(result.events[0].payload.external_order_id).toBe('ext-order-456');
    expect(mockPlaceOrder).toHaveBeenCalledOnce();
  });

  it('increments attempt count on failure without marking failed under 3 attempts', async () => {
    const mockPlaceOrder = vi.fn().mockResolvedValue({
      success: false,
      error: 'Provider unavailable',
    });
    (getProvider as any).mockReturnValue({
      providerType: 'print_on_demand',
      placeOrder: mockPlaceOrder,
    });

    let singleCallCount = 0;
    const supabase = createMockSupabase({
      single: vi.fn().mockImplementation(() => {
        singleCallCount++;
        if (singleCallCount === 1) {
          return Promise.resolve({
            data: { id: 'prov-1', provider_type: 'print_on_demand', config: {} },
            error: null,
          });
        }
        if (singleCallCount === 2) {
          return Promise.resolve({ data: null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      }),
    });

    const ctx = baseCtx({
      line: { ...baseCtx().line, submit_attempt_count: 0 },
    });
    const result = await executeExternalOrder(supabase, ctx);

    expect(result.success).toBe(false);
    // attempt 1 < 3, so no failed event emitted
    expect(result.events).toHaveLength(0);
  });

  it('marks line as failed after 3 attempts', async () => {
    const mockPlaceOrder = vi.fn().mockResolvedValue({
      success: false,
      error: 'Provider unavailable',
    });
    (getProvider as any).mockReturnValue({
      providerType: 'print_on_demand',
      placeOrder: mockPlaceOrder,
    });

    let singleCallCount = 0;
    const supabase = createMockSupabase({
      single: vi.fn().mockImplementation(() => {
        singleCallCount++;
        if (singleCallCount === 1) {
          return Promise.resolve({
            data: { id: 'prov-1', provider_type: 'print_on_demand', config: {} },
            error: null,
          });
        }
        if (singleCallCount === 2) {
          return Promise.resolve({ data: null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      }),
    });

    // submit_attempt_count = 2 means this will be attempt 3
    const ctx = baseCtx({
      line: { ...baseCtx().line, submit_attempt_count: 2 },
    });
    const result = await executeExternalOrder(supabase, ctx);

    expect(result.success).toBe(false);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].event_name).toBe('provision_line.failed');
    expect(result.events[0].payload.attempts).toBe(3);
  });
});
