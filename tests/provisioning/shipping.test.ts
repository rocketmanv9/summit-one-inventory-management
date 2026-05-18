import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.spyOn(console, 'log').mockImplementation(() => {});

import { resolveShippingAddress } from '../../src/lib/provisioning/shipping';

function createMockSupabase(overrides = {}) {
  const chainable: any = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    ...overrides,
  };
  const mockSchema = vi.fn().mockReturnValue(chainable);
  return { schema: mockSchema, _chainable: chainable } as any;
}

const EXPLICIT_ADDRESS = {
  name: 'John Doe',
  address1: '100 Main St',
  city: 'Denver',
  state: 'CO',
  zip: '80202',
  country: 'US',
  phone: '555-1234',
};

const LOCATION_SHIPPING_ADDRESS = {
  name: 'Warehouse West',
  address1: '500 Industrial Blvd',
  city: 'Phoenix',
  state: 'AZ',
  zip: '85001',
  country: 'US',
};

describe('resolveShippingAddress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns explicit address when provided', async () => {
    const sb = createMockSupabase();

    const result = await resolveShippingAddress(sb, 'tenant-1', {
      explicitAddress: EXPLICIT_ADDRESS,
    });

    expect(result).toEqual(EXPLICIT_ADDRESS);
    // Should not query the database at all
    expect(sb.schema).not.toHaveBeenCalled();
  });

  it('resolves from specific location by ID', async () => {
    const sb = createMockSupabase({
      single: vi.fn().mockResolvedValue({
        data: {
          shipping_address: LOCATION_SHIPPING_ADDRESS,
          name: 'West Warehouse',
          address: '500 Industrial Blvd, Phoenix AZ',
        },
        error: null,
      }),
    });

    const result = await resolveShippingAddress(sb, 'tenant-1', {
      shipToLocationId: 'loc-abc',
    });

    expect(result).toEqual(LOCATION_SHIPPING_ADDRESS);
    expect(sb.schema).toHaveBeenCalledWith('inventory');
    expect(sb._chainable.from).toHaveBeenCalledWith('locations');
    expect(sb._chainable.eq).toHaveBeenCalledWith('tenant_id', 'tenant-1');
    expect(sb._chainable.eq).toHaveBeenCalledWith('id', 'loc-abc');
  });

  it('falls back to tenant default location', async () => {
    const sb = createMockSupabase({
      single: vi.fn().mockResolvedValue({
        data: {
          shipping_address: LOCATION_SHIPPING_ADDRESS,
          name: 'Default Warehouse',
          address: '500 Industrial Blvd, Phoenix AZ',
        },
        error: null,
      }),
    });

    const result = await resolveShippingAddress(sb, 'tenant-1');

    expect(result).toEqual(LOCATION_SHIPPING_ADDRESS);
    expect(sb._chainable.eq).toHaveBeenCalledWith('is_default_ship_to', true);
  });

  it('throws AppError.badRequest when no address available', async () => {
    const sb = createMockSupabase({
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'No rows' },
      }),
    });

    await expect(resolveShippingAddress(sb, 'tenant-1')).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining('No shipping address available'),
    });
  });

  it('throws when location ID is not found', async () => {
    const sb = createMockSupabase({
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'No rows' },
      }),
    });

    await expect(
      resolveShippingAddress(sb, 'tenant-1', { shipToLocationId: 'loc-missing' }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining('loc-missing'),
    });
  });

  it('throws when location exists but has no shipping_address', async () => {
    const sb = createMockSupabase({
      single: vi.fn().mockResolvedValue({
        data: {
          shipping_address: null,
          name: 'Empty Warehouse',
          address: '123 Old Rd',
        },
        error: null,
      }),
    });

    await expect(
      resolveShippingAddress(sb, 'tenant-1', { shipToLocationId: 'loc-empty' }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining('does not have a shipping address configured'),
    });
  });

  it('converts location shipping_address JSONB to ShippingAddress', async () => {
    const jsonbAddress = {
      name: 'HQ Office',
      address1: '200 Corporate Dr',
      address2: 'Suite 400',
      city: 'Austin',
      state: 'TX',
      zip: '73301',
      country: 'US',
      phone: '512-555-0001',
      email: 'shipping@example.com',
    };

    const sb = createMockSupabase({
      single: vi.fn().mockResolvedValue({
        data: {
          shipping_address: jsonbAddress,
          name: 'HQ',
          address: '200 Corporate Dr',
        },
        error: null,
      }),
    });

    const result = await resolveShippingAddress(sb, 'tenant-1', {
      shipToLocationId: 'loc-hq',
    });

    expect(result).toEqual(jsonbAddress);
    expect(result.name).toBe('HQ Office');
    expect(result.address2).toBe('Suite 400');
    expect(result.phone).toBe('512-555-0001');
    expect(result.email).toBe('shipping@example.com');
  });
});
