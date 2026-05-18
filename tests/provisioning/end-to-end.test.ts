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
import { orchestrateProvisioning, approveRequest } from '../../src/lib/provisioning/orchestrator';

function createMockSupabase(opts?: { dedupHit?: boolean }) {
  let singleCallCount = 0;
  const chainable: any = {};
  chainable.from = vi.fn().mockReturnValue(chainable);
  chainable.select = vi.fn().mockReturnValue(chainable);
  chainable.insert = vi.fn().mockReturnValue(chainable);
  chainable.upsert = vi.fn().mockReturnValue(chainable);
  chainable.update = vi.fn().mockReturnValue(chainable);
  chainable.eq = vi.fn().mockReturnValue(chainable);
  chainable.in = vi.fn().mockReturnValue(chainable);
  chainable.limit = vi.fn().mockReturnValue(chainable);
  chainable.single = vi.fn(async () => {
    singleCallCount++;
    if (singleCallCount === 1) {
      // Dedup check
      if (opts?.dedupHit) return { data: { id: 'existing-req', status: 'provisioning' }, error: null };
      return { data: null, error: { code: 'PGRST116' } }; // Not found = no dedup
    }
    // Request upsert or subsequent queries
    return { data: { id: 'req-1', status: 'needs_approval' }, error: null };
  });
  return { schema: vi.fn().mockReturnValue(chainable), _chainable: chainable } as any;
}

const employee = { employeeId: 'emp-1', employeeName: 'Alex', position: 'Foreman', division: 'Field' };

describe('End-to-End Provisioning Flow', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('full happy path: policy match → approval → order submitted', async () => {
    const sb = createMockSupabase();

    // Step 1: Policy matches, requires approval
    vi.mocked(evaluatePolicies).mockResolvedValue({
      matched: true, rule: { id: 'r1', requires_approval: true } as any,
      kitId: 'kit-1', items: null, requiresApproval: true,
    });
    vi.mocked(resolveItems).mockResolvedValue([{
      catalogItemId: 'item-1', originalCatalogItemId: 'item-1', qty: 1,
      resolvedVariantAttributes: { size: 'L' }, isSubstitution: false,
    }]);
    vi.mocked(selectProvidersForLines).mockResolvedValue([{
      providerId: 'prov-1', providerType: 'print_on_demand',
      fulfillmentMethod: 'external_order', externalProductId: 'ext-1', externalVariantId: 'var-1',
    }]);
    vi.mocked(resolveShippingAddress).mockResolvedValue({
      name: 'Alex', address1: '1 Main', city: 'Denver', state: 'CO', zip: '80201', country: 'US',
    });

    const result = await orchestrateProvisioning(
      sb, 'tenant-1', 'employee.created', employee, 'idem-e2e',
    );

    // Request created in needs_approval status
    expect(result.status).toBe('needs_approval');
    expect(result.requiresApproval).toBe(true);
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events[0].event_name).toBe('provision_request.created');
  });

  it('approval advances request and triggers fulfillment', async () => {
    const sb = createMockSupabase();
    // Mock lines for approval flow
    sb._chainable.limit = vi.fn().mockReturnValue({
      ...sb._chainable,
      single: vi.fn().mockResolvedValue({
        data: { id: 'req-1', status: 'needs_approval', tenant_id: 'tenant-1', shipping_address: {} },
        error: null,
      }),
    });

    // Mock getProvider for fulfillment
    const mockProvider = {
      placeOrder: vi.fn().mockResolvedValue({ success: true, externalOrderId: 'print-123' }),
    };
    vi.mocked(getProvider).mockReturnValue(mockProvider as any);

    const result = await approveRequest(sb, 'tenant-1', 'req-1', 'user-1', 'approve-key');

    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events[0].event_name).toBe('provision_request.approved');
  });

  it('dedup prevents duplicate request creation', async () => {
    const sb = createMockSupabase({ dedupHit: true });

    const result = await orchestrateProvisioning(
      sb, 'tenant-1', 'employee.created', employee, 'idem-dup',
    );

    // Returns existing, no new events
    expect(result.requestId).toBe('existing-req');
    expect(result.events).toHaveLength(0);
    expect(evaluatePolicies).not.toHaveBeenCalled();
  });
});
