import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.spyOn(console, 'log').mockImplementation(() => {});

vi.mock('../../src/lib/provisioning/policy-engine', () => ({ evaluatePolicies: vi.fn() }));
vi.mock('../../src/lib/provisioning/variant-resolver', () => ({ resolveItems: vi.fn() }));
vi.mock('../../src/lib/provisioning/provider-selector', () => ({ selectProvidersForLines: vi.fn() }));
vi.mock('../../src/lib/provisioning/providers/registry', () => ({ getProvider: vi.fn(), registerProvider: vi.fn() }));
vi.mock('../../src/lib/provisioning/providers/internal-warehouse', () => ({}));
vi.mock('../../src/lib/provisioning/providers/printify', () => ({}));
vi.mock('../../src/lib/provisioning/shipping', () => ({ resolveShippingAddress: vi.fn() }));
vi.mock('@rocketmanv9/chassis/supabase', () => ({ createTenantServiceClient: vi.fn() }));

import { evaluatePolicies } from '../../src/lib/provisioning/policy-engine';
import { resolveItems } from '../../src/lib/provisioning/variant-resolver';
import { selectProvidersForLines } from '../../src/lib/provisioning/provider-selector';
import { resolveShippingAddress } from '../../src/lib/provisioning/shipping';
import { getProvider } from '../../src/lib/provisioning/providers/registry';
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
    if (singleCallCount === 1) return { data: null, error: { code: 'PGRST116' } };
    return { data: { id: 'req-1', status: 'pending' }, error: null };
  });
  return { schema: vi.fn().mockReturnValue(chainable), _chainable: chainable } as any;
}

const employee = { employeeId: 'emp-1', employeeName: 'Jane', position: 'Tech' };

describe('Dry-Run Mode', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('sets isDryRun and does not call placeOrder', async () => {
    const sb = createMockSupabase();

    vi.mocked(evaluatePolicies).mockResolvedValue({
      matched: true, rule: { id: 'r1' } as any, kitId: 'k1', items: null, requiresApproval: false,
    });
    vi.mocked(resolveItems).mockResolvedValue([{
      catalogItemId: 'item-1', originalCatalogItemId: 'item-1', qty: 1,
      resolvedVariantAttributes: { size: 'M' }, isSubstitution: false,
    }]);
    vi.mocked(selectProvidersForLines).mockResolvedValue([{
      providerId: 'prov-1', providerType: 'print_on_demand',
      fulfillmentMethod: 'external_order', externalProductId: 'ext-1', externalVariantId: 'var-1',
    }]);
    vi.mocked(resolveShippingAddress).mockResolvedValue({
      name: 'Jane', address1: '1 St', city: 'LA', state: 'CA', zip: '90001', country: 'US',
    });

    const mockProvider = { placeOrder: vi.fn() };
    vi.mocked(getProvider).mockReturnValue(mockProvider as any);

    const result = await orchestrateProvisioning(
      sb, 'tenant-1', 'employee.created', employee, 'idem-dry',
      { dryRun: true },
    );

    expect(result.isDryRun).toBe(true);
    expect(mockProvider.placeOrder).not.toHaveBeenCalled();
  });
});
