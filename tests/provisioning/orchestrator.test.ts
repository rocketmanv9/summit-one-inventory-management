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

// Mock internal warehouse (prevents self-registration side effect)
vi.mock('../../src/lib/provisioning/providers/internal-warehouse', () => ({}));

// Mock chassis
vi.mock('@rocketmanv9/chassis/supabase', () => ({
  createTenantServiceClient: vi.fn(),
}));

import { evaluatePolicies } from '../../src/lib/provisioning/policy-engine';
import { resolveItems } from '../../src/lib/provisioning/variant-resolver';
import { selectProvidersForLines } from '../../src/lib/provisioning/provider-selector';
import { orchestrateProvisioning } from '../../src/lib/provisioning/orchestrator';

function createMockSupabase(overrides: Record<string, any> = {}) {
  const chainable: any = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    contains: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    ...overrides,
  };
  const mockSchema = vi.fn().mockReturnValue(chainable);
  return { schema: mockSchema, _chainable: chainable } as any;
}

describe('orchestrateProvisioning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns no_match when no policies match', async () => {
    (evaluatePolicies as any).mockResolvedValue({
      matched: false,
      rule: null,
      kitId: null,
      items: null,
      requiresApproval: false,
    });

    const supabase = createMockSupabase();
    // Mock dedup check returns no existing request
    supabase._chainable.single.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });

    const result = await orchestrateProvisioning(
      supabase,
      'tenant-1',
      'employee.created',
      { employeeId: 'emp-1', employeeName: 'John' },
      'idem-key-1',
    );

    expect(result.status).toBe('no_match');
    expect(result.lines).toHaveLength(0);
  });

  it('returns existing request on duplicate dedup key', async () => {
    const supabase = createMockSupabase();
    // First .single() call returns existing request (dedup check)
    let callCount = 0;
    supabase._chainable.single.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ data: { id: 'req-existing', status: 'fulfilled' }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    // Mock lines query
    supabase._chainable.limit.mockReturnValue({
      ...supabase._chainable,
      single: supabase._chainable.single,
    });

    const result = await orchestrateProvisioning(
      supabase,
      'tenant-1',
      'employee.created',
      { employeeId: 'emp-1', employeeName: 'John' },
      'idem-key-1',
    );

    expect(result.requestId).toBe('req-existing');
    expect(result.status).toBe('fulfilled');
    expect(evaluatePolicies).not.toHaveBeenCalled();
  });

  it('returns no_items when variant resolver returns empty', async () => {
    const supabase = createMockSupabase();
    supabase._chainable.single.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });

    (evaluatePolicies as any).mockResolvedValue({
      matched: true,
      rule: { id: 'rule-1' },
      kitId: 'kit-1',
      items: null,
      requiresApproval: false,
    });

    (resolveItems as any).mockResolvedValue([]);

    const result = await orchestrateProvisioning(
      supabase,
      'tenant-1',
      'employee.created',
      { employeeId: 'emp-1', employeeName: 'John' },
      'idem-key-1',
    );

    expect(result.status).toBe('no_items');
  });
});
