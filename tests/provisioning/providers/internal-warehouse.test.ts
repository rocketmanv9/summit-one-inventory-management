import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.spyOn(console, 'log').mockImplementation(() => {});

// Mock chassis supabase
vi.mock('@rocketmanv9/chassis/supabase', () => ({
  createTenantServiceClient: vi.fn(),
}));

import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';

// We need to import after mocking
import { internalWarehouseProvider } from '../../../src/lib/provisioning/providers/internal-warehouse';

function createMockInvClient(stockBalances: any[] = [], reserveError: any = null) {
  const chainable: any = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: stockBalances, error: null }),
    rpc: vi.fn().mockResolvedValue({ error: reserveError }),
  };
  const mockSchema = vi.fn().mockReturnValue(chainable);
  return { schema: mockSchema, _chainable: chainable };
}

describe('internalWarehouseProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has correct provider type', () => {
    expect(internalWarehouseProvider.providerType).toBe('internal_warehouse');
  });

  it('returns backordered when no stock available', async () => {
    const mockClient = createMockInvClient([]);
    (createTenantServiceClient as any).mockResolvedValue(mockClient);

    const result = await internalWarehouseProvider.placeOrder(
      {
        tenantId: 'tenant-1',
        requestId: 'req-1',
        idempotencyKey: 'key-1',
        items: [{
          lineId: 'line-1',
          catalogItemId: 'item-1',
          externalProductId: '',
          externalVariantId: '',
          qty: 5,
        }],
      },
      {},
    );

    expect(result.success).toBe(false);
    expect(result.lineResults?.[0]?.status).toBe('backordered');
  });

  it('reserves stock when available', async () => {
    const mockClient = createMockInvClient([{ location_id: 'loc-1', qty_available: 10 }]);
    (createTenantServiceClient as any).mockResolvedValue(mockClient);

    const result = await internalWarehouseProvider.placeOrder(
      {
        tenantId: 'tenant-1',
        requestId: 'req-1',
        idempotencyKey: 'key-1',
        items: [{
          lineId: 'line-1',
          catalogItemId: 'item-1',
          externalProductId: '',
          externalVariantId: '',
          qty: 2,
        }],
      },
      {},
    );

    expect(result.success).toBe(true);
    expect(result.lineResults?.[0]?.status).toBe('reserved');
  });

  it('returns failed when reserve RPC errors', async () => {
    const mockClient = createMockInvClient(
      [{ location_id: 'loc-1', qty_available: 10 }],
      { message: 'Insufficient stock' },
    );
    (createTenantServiceClient as any).mockResolvedValue(mockClient);

    const result = await internalWarehouseProvider.placeOrder(
      {
        tenantId: 'tenant-1',
        requestId: 'req-1',
        idempotencyKey: 'key-1',
        items: [{
          lineId: 'line-1',
          catalogItemId: 'item-1',
          externalProductId: '',
          externalVariantId: '',
          qty: 2,
        }],
      },
      {},
    );

    expect(result.success).toBe(false);
    expect(result.lineResults?.[0]?.status).toBe('failed');
    expect(result.lineResults?.[0]?.error).toBe('Insufficient stock');
  });

  it('validates config always succeeds', async () => {
    const result = await internalWarehouseProvider.validateConfig({});
    expect(result.valid).toBe(true);
  });

  it('estimates cost as zero', async () => {
    const result = await internalWarehouseProvider.estimateCost!(
      [{ lineId: 'l1', catalogItemId: 'i1', externalProductId: '', externalVariantId: '', qty: 1 }],
      {},
    );
    expect(result.totalCost).toBe(0);
  });
});
