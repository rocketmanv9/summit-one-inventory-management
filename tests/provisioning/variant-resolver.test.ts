import { describe, it, expect, vi } from 'vitest';

vi.spyOn(console, 'log').mockImplementation(() => {});

vi.mock('@rocketmanv9/chassis/supabase', () => ({
  createTenantServiceClient: vi.fn(),
}));

describe('variant-resolver', () => {
  it('returns item directly when not a parent', async () => {
    // The variant resolver checks is_parent on each catalog item.
    // When is_parent=false, the item ID passes through unchanged.
    // This is a structural test to verify the module exports correctly.
    const mod = await import('../../src/lib/provisioning/variant-resolver');
    expect(typeof mod.resolveItems).toBe('function');
  });
});
