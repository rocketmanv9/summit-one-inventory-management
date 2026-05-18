import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.spyOn(console, 'log').mockImplementation(() => {});

// Mock the policy engine
vi.mock('../../src/lib/provisioning/policy-engine', () => ({
  evaluatePolicies: vi.fn(),
}));

// Mock the variant resolver
vi.mock('../../src/lib/provisioning/variant-resolver', () => ({
  resolveItems: vi.fn(),
}));

// Mock the provider selector
vi.mock('../../src/lib/provisioning/provider-selector', () => ({
  selectProvidersForLines: vi.fn(),
}));

// Mock the provider registry
vi.mock('../../src/lib/provisioning/providers/registry', () => ({
  getProvider: vi.fn(),
  registerProvider: vi.fn(),
}));

// Mock providers (prevents self-registration side effects)
vi.mock('../../src/lib/provisioning/providers/internal-warehouse', () => ({}));
vi.mock('../../src/lib/provisioning/providers/printify', () => ({}));

// Mock shipping
vi.mock('../../src/lib/provisioning/shipping', () => ({
  resolveShippingAddress: vi.fn(),
}));

// Mock chassis
vi.mock('@rocketmanv9/chassis/supabase', () => ({
  createTenantServiceClient: vi.fn(),
}));

// Mock admin client
vi.mock('../../src/utils/supabase/admin', () => ({
  getAdminClient: vi.fn(),
}));

import { evaluatePolicies } from '../../src/lib/provisioning/policy-engine';
import { resolveItems } from '../../src/lib/provisioning/variant-resolver';
import { selectProvidersForLines } from '../../src/lib/provisioning/provider-selector';
import { getProvider } from '../../src/lib/provisioning/providers/registry';
import { resolveShippingAddress } from '../../src/lib/provisioning/shipping';
import { orchestrateProvisioning, approveRequest } from '../../src/lib/provisioning/orchestrator';

function createMockSupabase(overrides: Record<string, any> = {}) {
  const chainable: any = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    ...overrides,
  };
  const mockSchema = vi.fn().mockReturnValue(chainable);
  return { schema: mockSchema, _chainable: chainable } as any;
}

const employee = {
  employeeId: 'emp-1',
  employeeName: 'Jane Doe',
  position: 'field_tech',
  division: 'ops',
  location: 'CO',
};

describe('orchestrateProvisioning — external_order lines', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls provider.placeOrder for external_order lines when not requiring approval', async () => {
    (evaluatePolicies as any).mockResolvedValue({
      matched: true,
      kitId: 'kit-1',
      items: null,
      requiresApproval: false,
      rule: { id: 'rule-1' },
    });

    (resolveItems as any).mockResolvedValue([
      {
        catalogItemId: 'cat-1',
        qty: 1,
        resolvedVariantAttributes: { size: 'M' },
      },
    ]);

    (selectProvidersForLines as any).mockResolvedValue([
      {
        providerId: 'prov-printify',
        providerType: 'print_on_demand',
        fulfillmentMethod: 'external_order',
        externalProductId: 'prod-1',
        externalVariantId: 'var-1',
      },
    ]);

    const mockPlaceOrder = vi.fn().mockResolvedValue({
      success: true,
      externalOrderId: 'ext-123',
    });
    (getProvider as any).mockReturnValue({
      providerType: 'print_on_demand',
      placeOrder: mockPlaceOrder,
    });

    (resolveShippingAddress as any).mockResolvedValue({
      name: 'Jane Doe',
      address1: '123 Main St',
      city: 'Denver',
      state: 'CO',
      zip: '80202',
      country: 'US',
    });

    let singleCallCount = 0;
    const supabase = createMockSupabase({
      single: vi.fn().mockImplementation(() => {
        singleCallCount++;
        if (singleCallCount === 1) {
          // Dedup check — no existing request
          return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
        }
        if (singleCallCount === 2) {
          // Create request
          return Promise.resolve({ data: { id: 'req-1' }, error: null });
        }
        if (singleCallCount === 3) {
          // Create line
          return Promise.resolve({ data: { id: 'line-1' }, error: null });
        }
        if (singleCallCount === 4) {
          // Provider config lookup
          return Promise.resolve({
            data: { config: { api_token_ref: 'vault-ref', shop_id: 'shop-1' } },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      }),
    });

    const result = await orchestrateProvisioning(
      supabase,
      'tenant-1',
      'employee.created',
      employee,
      'idem-1',
    );

    expect(result.status).toBe('provisioning');
    expect(mockPlaceOrder).toHaveBeenCalledOnce();
    // Should have events for request.created + line ordered/failed
    const orderEvents = result.events.filter(
      (e) => e.event_name === 'provision_line.ordered' || e.event_name === 'provision_line.failed',
    );
    expect(orderEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('skips external_order lines when requiresApproval is true', async () => {
    (evaluatePolicies as any).mockResolvedValue({
      matched: true,
      kitId: 'kit-1',
      items: null,
      requiresApproval: true,
      rule: { id: 'rule-1' },
    });

    (resolveItems as any).mockResolvedValue([
      { catalogItemId: 'cat-1', qty: 1, resolvedVariantAttributes: {} },
    ]);

    (selectProvidersForLines as any).mockResolvedValue([
      {
        providerId: 'prov-printify',
        providerType: 'print_on_demand',
        fulfillmentMethod: 'external_order',
      },
    ]);

    (getProvider as any).mockReturnValue(null);

    (resolveShippingAddress as any).mockResolvedValue(undefined);

    let singleCallCount = 0;
    const supabase = createMockSupabase({
      single: vi.fn().mockImplementation(() => {
        singleCallCount++;
        if (singleCallCount === 1) return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
        if (singleCallCount === 2) return Promise.resolve({ data: { id: 'req-1' }, error: null });
        if (singleCallCount === 3) return Promise.resolve({ data: { id: 'line-1' }, error: null });
        return Promise.resolve({ data: null, error: null });
      }),
    });

    const result = await orchestrateProvisioning(
      supabase,
      'tenant-1',
      'employee.created',
      employee,
      'idem-1',
    );

    // Blocking detection runs before approval — missing mapping detected
    expect(result.status).toBe('needs_mapping');
    // No placeOrder call since request is blocked
    expect(getProvider).not.toHaveBeenCalled();
  });
});

describe('approveRequest — external_order lines', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('places external orders for pending external_order lines on approval', async () => {
    const mockPlaceOrder = vi.fn().mockResolvedValue({
      success: true,
      externalOrderId: 'ext-789',
    });
    (getProvider as any).mockReturnValue({
      providerType: 'print_on_demand',
      placeOrder: mockPlaceOrder,
    });

    (resolveShippingAddress as any).mockResolvedValue({
      name: 'Jane Doe',
      address1: '456 Oak Ave',
      city: 'Boulder',
      state: 'CO',
      zip: '80301',
      country: 'US',
    });

    let singleCallCount = 0;
    let limitCallCount = 0;
    const chainable: any = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      limit: vi.fn().mockImplementation(function () {
        limitCallCount++;
        if (limitCallCount === 1) {
          // request lookup -> .limit(1).single()
          return {
            single: () => {
              singleCallCount++;
              return Promise.resolve({
                data: { id: 'req-1', status: 'awaiting_approval', shipping_address: null },
                error: null,
              });
            },
          };
        }
        if (limitCallCount === 2) {
          // lines query -> resolves directly (no .single())
          return Promise.resolve({
            data: [
              {
                id: 'line-1',
                catalog_item_id: 'cat-1',
                qty: 2,
                fulfillment_method: 'external_order',
                provider_id: 'prov-1',
                external_product_id: 'prod-1',
                external_variant_id: 'var-1',
                status: 'pending',
              },
            ],
            error: null,
          });
        }
        if (limitCallCount === 3) {
          // provider record lookup -> .limit(1).single()
          return {
            single: () => {
              singleCallCount++;
              return Promise.resolve({
                data: { provider_type: 'print_on_demand', config: { shop_id: 'shop-1' } },
                error: null,
              });
            },
          };
        }
        return { single: () => Promise.resolve({ data: null, error: null }) };
      }),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const supabase = { schema: vi.fn().mockReturnValue(chainable), _chainable: chainable } as any;

    const result = await approveRequest(supabase, 'tenant-1', 'req-1', 'user-1', 'idem-approve');

    expect(mockPlaceOrder).toHaveBeenCalledOnce();
    const orderEvents = result.events.filter(
      (e) => e.event_name === 'provision_line.ordered' || e.event_name === 'provision_line.failed',
    );
    expect(orderEvents.length).toBeGreaterThanOrEqual(1);
  });
});
