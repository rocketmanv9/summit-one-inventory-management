import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.spyOn(console, 'log').mockImplementation(() => {});

import {
  getEmployeeSizing,
  upsertEmployeeSizing,
  getSizingForVariantResolution,
} from '../../src/lib/provisioning/employee-sizing';

function createMockSupabase(overrides: Record<string, any> = {}) {
  const chainable: any = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    ...overrides,
  };
  return { schema: vi.fn().mockReturnValue(chainable), _chainable: chainable } as any;
}

describe('getEmployeeSizing', () => {
  it('returns sizing record when found', async () => {
    const sizing = { id: 's1', employee_id: 'e1', shirt_size: 'L', boot_size: '10' };
    const sb = createMockSupabase({
      single: vi.fn().mockResolvedValue({ data: sizing, error: null }),
    });
    const result = await getEmployeeSizing(sb, 'tenant1', 'e1');
    expect(result).toEqual(sizing);
  });

  it('returns null when not found', async () => {
    const sb = createMockSupabase({
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
    });
    const result = await getEmployeeSizing(sb, 'tenant1', 'missing');
    expect(result).toBeNull();
  });
});

describe('upsertEmployeeSizing', () => {
  it('upserts and returns record', async () => {
    const created = { id: 's1', employee_id: 'e1', shirt_size: 'XL' };
    const sb = createMockSupabase({
      single: vi.fn().mockResolvedValue({ data: created, error: null }),
    });
    const result = await upsertEmployeeSizing(sb, 'tenant1', 'e1', { shirt_size: 'XL' }, 'key-1');
    expect(result).toEqual(created);
    expect(sb._chainable.upsert).toHaveBeenCalled();
  });
});

describe('getSizingForVariantResolution', () => {
  it('returns size attributes for shirt_size dimension', async () => {
    const sizing = { id: 's1', employee_id: 'e1', shirt_size: 'M', boot_size: '11' };
    const sb = createMockSupabase({
      single: vi.fn().mockResolvedValue({ data: sizing, error: null }),
    });
    const result = await getSizingForVariantResolution(sb, 'tenant1', 'e1', 'shirt_size');
    expect(result).toEqual({ size: 'M', shirt_size: 'M' });
  });

  it('returns size attributes for boot_size dimension', async () => {
    const sizing = { id: 's1', employee_id: 'e1', shirt_size: 'M', boot_size: '11' };
    const sb = createMockSupabase({
      single: vi.fn().mockResolvedValue({ data: sizing, error: null }),
    });
    const result = await getSizingForVariantResolution(sb, 'tenant1', 'e1', 'boot_size');
    expect(result).toEqual({ size: '11', boot_size: '11' });
  });

  it('defaults to shirt_size when no dimension specified', async () => {
    const sizing = { id: 's1', employee_id: 'e1', shirt_size: 'L', boot_size: null };
    const sb = createMockSupabase({
      single: vi.fn().mockResolvedValue({ data: sizing, error: null }),
    });
    const result = await getSizingForVariantResolution(sb, 'tenant1', 'e1');
    expect(result).toEqual({ size: 'L', shirt_size: 'L' });
  });

  it('returns empty object when no sizing record exists', async () => {
    const sb = createMockSupabase({
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
    });
    const result = await getSizingForVariantResolution(sb, 'tenant1', 'e1');
    expect(result).toEqual({});
  });

  it('returns empty object when requested dimension is null', async () => {
    const sizing = { id: 's1', employee_id: 'e1', shirt_size: null, boot_size: null };
    const sb = createMockSupabase({
      single: vi.fn().mockResolvedValue({ data: sizing, error: null }),
    });
    const result = await getSizingForVariantResolution(sb, 'tenant1', 'e1', 'shirt_size');
    expect(result).toEqual({});
  });
});
