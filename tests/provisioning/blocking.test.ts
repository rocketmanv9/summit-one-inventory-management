import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.spyOn(console, 'log').mockImplementation(() => {});

vi.mock('../../src/lib/provisioning/policy-engine', () => ({
  evaluatePolicies: vi.fn(),
}));
vi.mock('../../src/lib/provisioning/variant-resolver', () => ({
  resolveItems: vi.fn(),
}));
vi.mock('../../src/lib/provisioning/provider-selector', () => ({
  selectProvidersForLines: vi.fn(),
}));
vi.mock('../../src/lib/provisioning/providers/registry', () => ({
  getProvider: vi.fn(),
  registerProvider: vi.fn(),
}));
vi.mock('../../src/lib/provisioning/providers/internal-warehouse', () => ({}));
vi.mock('../../src/lib/provisioning/providers/printify', () => ({}));
vi.mock('../../src/lib/provisioning/shipping', () => ({
  resolveShippingAddress: vi.fn(),
}));
vi.mock('@rocketmanv9/chassis/supabase', () => ({
  createTenantServiceClient: vi.fn(),
}));

import { evaluatePolicies } from '../../src/lib/provisioning/policy-engine';
import { resolveItems } from '../../src/lib/provisioning/variant-resolver';
import { selectProvidersForLines } from '../../src/lib/provisioning/provider-selector';
import { resolveShippingAddress } from '../../src/lib/provisioning/shipping';
import { orchestrateProvisioning } from '../../src/lib/provisioning/orchestrator';

function createMockSupabase() {
  let singleCallCount = 0;
  const chainable: any = {};
  chainable.from = vi.fn(() => chainable);
  chainable.select = vi.fn(() => chainable);
  chainable.insert = vi.fn(() => chainable);
  chainable.upsert = vi.fn(() => chainable);
  chainable.update = vi.fn(() => chainable);
  chainable.eq = vi.fn(() => chainable);
  chainable.in = vi.fn(() => chainable);
  chainable.limit = vi.fn(() => chainable);
  chainable.single = vi.fn(async () => {
    singleCallCount++;
    if (singleCallCount === 1) {
      // Dedup check — no existing request
      return { data: null, error: { code: 'PGRST116' } };
    }
    // Request upsert returns created request
    return { data: { id: `req-${singleCallCount}`, status: 'pending' }, error: null };
  });
  return { schema: vi.fn().mockReturnValue(chainable), _chainable: chainable } as any;
}

const employee = {
  employeeId: 'emp-1',
  employeeName: 'John Doe',
  position: 'Electrician',
  division: 'Field',
};

describe('Blocking State Detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detects missing_mapping when external product ID is absent', async () => {
    const sb = createMockSupabase();

    vi.mocked(evaluatePolicies).mockResolvedValue({
      matched: true,
      rule: { id: 'rule-1' } as any,
      kitId: 'kit-1',
      items: null,
      requiresApproval: false,
    });

    vi.mocked(resolveItems).mockResolvedValue([{
      catalogItemId: 'item-1',
      originalCatalogItemId: 'item-1',
      qty: 1,
      resolvedVariantAttributes: { size: 'L' },
      isSubstitution: false,
    }]);

    vi.mocked(selectProvidersForLines).mockResolvedValue([{
      providerId: 'prov-1',
      providerType: 'print_on_demand',
      fulfillmentMethod: 'external_order',
      externalProductId: undefined,  // Missing!
      externalVariantId: undefined,  // Missing!
    }]);

    vi.mocked(resolveShippingAddress).mockResolvedValue({
      name: 'John', address1: '123 St', city: 'NYC', state: 'NY', zip: '10001', country: 'US',
    });

    const result = await orchestrateProvisioning(
      sb, 'tenant-1', 'employee.created', employee, 'idem-1',
    );

    expect(result.status).toBe('needs_mapping');
    expect(result.blockingReasons).toBeDefined();
    expect(result.blockingReasons!.some(r => r.type === 'missing_mapping')).toBe(true);
  });

  it('detects missing_sizing when variant resolution failed', async () => {
    const sb = createMockSupabase();

    vi.mocked(evaluatePolicies).mockResolvedValue({
      matched: true,
      rule: { id: 'rule-1' } as any,
      kitId: 'kit-1',
      items: null,
      requiresApproval: false,
    });

    vi.mocked(resolveItems).mockResolvedValue([{
      catalogItemId: 'item-1',
      originalCatalogItemId: 'parent-1',
      qty: 1,
      resolvedVariantAttributes: null,
      isSubstitution: false,
      substitutionReason: 'Variant resolution failed; manual selection required',
    }]);

    vi.mocked(selectProvidersForLines).mockResolvedValue([{
      providerId: 'prov-1',
      providerType: 'print_on_demand',
      fulfillmentMethod: 'external_order',
      externalProductId: 'ext-1',
      externalVariantId: 'var-1',
    }]);

    vi.mocked(resolveShippingAddress).mockResolvedValue({
      name: 'John', address1: '123 St', city: 'NYC', state: 'NY', zip: '10001', country: 'US',
    });

    const result = await orchestrateProvisioning(
      sb, 'tenant-1', 'employee.created', employee, 'idem-2',
    );

    expect(result.blockingReasons).toBeDefined();
    expect(result.blockingReasons!.some(r => r.type === 'missing_sizing')).toBe(true);
  });

  it('detects missing_address when no shipping address and has external orders', async () => {
    const sb = createMockSupabase();

    vi.mocked(evaluatePolicies).mockResolvedValue({
      matched: true,
      rule: { id: 'rule-1' } as any,
      kitId: 'kit-1',
      items: null,
      requiresApproval: false,
    });

    vi.mocked(resolveItems).mockResolvedValue([{
      catalogItemId: 'item-1',
      originalCatalogItemId: 'item-1',
      qty: 1,
      resolvedVariantAttributes: { size: 'L' },
      isSubstitution: false,
    }]);

    vi.mocked(selectProvidersForLines).mockResolvedValue([{
      providerId: 'prov-1',
      providerType: 'print_on_demand',
      fulfillmentMethod: 'external_order',
      externalProductId: 'ext-1',
      externalVariantId: 'var-1',
    }]);

    // Shipping resolution fails
    vi.mocked(resolveShippingAddress).mockRejectedValue(new Error('No address'));

    const result = await orchestrateProvisioning(
      sb, 'tenant-1', 'employee.created', employee, 'idem-3',
    );

    expect(result.blockingReasons).toBeDefined();
    expect(result.blockingReasons!.some(r => r.type === 'missing_address')).toBe(true);
  });
});
