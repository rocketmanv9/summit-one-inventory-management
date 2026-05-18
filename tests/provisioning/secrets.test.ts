import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.spyOn(console, 'log').mockImplementation(() => {});

import { maskProviderConfig, isVaultRef } from '../../src/lib/provisioning/providers/secrets';

describe('maskProviderConfig', () => {
  it('replaces api_token_ref with mask', () => {
    const config = { api_token_ref: 'provider-secret-t1-p1', shop_id: 'shop-1' };
    const masked = maskProviderConfig(config);
    expect(masked.api_token_ref).toBe('********');
    expect(masked.shop_id).toBe('shop-1');
  });

  it('does not modify config without api_token_ref', () => {
    const config = { shop_id: 'shop-1', some_other: 'value' };
    const masked = maskProviderConfig(config);
    expect(masked).toEqual(config);
  });

  it('returns falsy config as-is', () => {
    expect(maskProviderConfig(null as any)).toBeNull();
  });

  it('does not mutate original object', () => {
    const config = { api_token_ref: 'secret-value', shop_id: 'shop-1' };
    maskProviderConfig(config);
    expect(config.api_token_ref).toBe('secret-value');
  });
});

describe('isVaultRef', () => {
  it('returns true for vault reference names', () => {
    expect(isVaultRef('provider-secret-tenant-id-provider-id')).toBe(true);
  });

  it('returns false for plaintext tokens', () => {
    expect(isVaultRef('pat_abc123xyz')).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isVaultRef(null)).toBe(false);
    expect(isVaultRef(undefined)).toBe(false);
  });
});
