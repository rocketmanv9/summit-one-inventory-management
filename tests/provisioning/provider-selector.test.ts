import { describe, it, expect, vi } from 'vitest';

vi.spyOn(console, 'log').mockImplementation(() => {});

vi.mock('@rocketmanv9/chassis/supabase', () => ({
  createTenantServiceClient: vi.fn(),
}));

describe('provider-selector', () => {
  it('exports selectProvider and selectProvidersForLines', async () => {
    const mod = await import('../../src/lib/provisioning/provider-selector');
    expect(typeof mod.selectProvider).toBe('function');
    expect(typeof mod.selectProvidersForLines).toBe('function');
  });
});
