import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.spyOn(console, 'log').mockImplementation(() => {});

import { resolveBlocker } from '../../src/lib/provisioning/blocker-resolver';

function createMockSupabase(requestData: any, linesData: any[] = [], policyData: any = null) {
  let fromTable = '';
  let selectCalled = false;

  const chainable: any = {};
  chainable.from = vi.fn((table: string) => { fromTable = table; selectCalled = false; return chainable; });
  chainable.select = vi.fn(() => { selectCalled = true; return chainable; });
  chainable.insert = vi.fn().mockResolvedValue({ error: null });
  chainable.upsert = vi.fn().mockReturnValue(chainable);
  chainable.update = vi.fn().mockReturnValue(chainable);
  chainable.eq = vi.fn().mockReturnValue(chainable);
  chainable.in = vi.fn().mockReturnValue(chainable);
  chainable.limit = vi.fn().mockReturnValue(chainable);
  chainable.single = vi.fn(async () => {
      if (fromTable === 'provisioning_requests') {
        return { data: requestData, error: null };
      }
      if (fromTable === 'provider_item_mappings') {
        return { data: { external_product_id: 'ext-1', external_variant_id: 'var-1' }, error: null };
      }
      if (fromTable === 'policy_rules') {
        return { data: policyData, error: null };
      }
      return { data: null, error: null };
    });
  return { schema: vi.fn().mockReturnValue(chainable), _chainable: chainable } as any;
}

describe('resolveBlocker', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('throws when request is not in a blocked state', async () => {
    const sb = createMockSupabase({ status: 'provisioning', employee_id: 'e1' });
    await expect(resolveBlocker(sb, 'tenant1', 'req-1', 'key-1'))
      .rejects.toThrow('not in a blocked state');
  });

  it('advances to needs_approval when blockers resolved and approval required', async () => {
    const requestWithLines = {
      status: 'needs_mapping',
      employee_id: 'e1',
      policy_rule_id: 'rule-1',
      shipping_address: { name: 'J', address1: '1', city: 'A', state: 'B', zip: '1', country: 'US' },
      provisioning_lines: [{
        id: 'line-1',
        status: 'needs_mapping',
        fulfillment_method: 'external_order',
        catalog_item_id: 'item-1',
        provider_id: 'prov-1',
        substitution_reason: null,
      }],
    };

    const sb = createMockSupabase(
      requestWithLines,
      [],
      { requires_approval: true },
    );

    const result = await resolveBlocker(sb, 'tenant1', 'req-1', 'key-1');
    expect(result.resolved).toBe(true);
    expect(result.newStatus).toBe('needs_approval');
    expect(result.remainingBlockers).toHaveLength(0);
  });
});
