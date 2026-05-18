import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock modules before imports
vi.mock('@/lib/provisioning/providers/printify-client', () => ({
  listPrintifyProducts: vi.fn(),
}));

vi.mock('@/lib/provisioning/providers/secrets', () => ({
  resolveProviderSecret: vi.fn(),
  isVaultRef: vi.fn(),
}));

vi.mock('@/utils/supabase/admin', () => ({
  getAdminClient: vi.fn(() => ({})),
}));

vi.mock('@rocketmanv9/chassis/supabase', () => ({
  createTenantServiceClient: vi.fn(),
}));

vi.mock('@rocketmanv9/chassis/nextjs', () => ({
  createSessionReadRoute: vi.fn((handler: any) => handler),
}));

vi.mock('@rocketmanv9/chassis/errors', () => ({
  AppError: {
    badRequest: (msg: string) => Object.assign(new Error(msg), { status: 400 }),
    notFound: (msg: string) => Object.assign(new Error(msg), { status: 404 }),
  },
}));

import { listPrintifyProducts } from '@/lib/provisioning/providers/printify-client';
import { resolveProviderSecret, isVaultRef } from '@/lib/provisioning/providers/secrets';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';

const mockProducts = [
  { id: 'prod-1', title: 'Logo Tee', variants: [{ id: 101, title: 'S / Black' }, { id: 102, title: 'M / Black' }] },
  { id: 'prod-2', title: 'Cap', variants: [{ id: 201, title: 'One Size' }] },
];

describe('Provider Products Route', () => {
  const mockSingle = vi.fn();
  const mockLimit = vi.fn(() => ({ single: mockSingle }));
  const mockEq2 = vi.fn(() => ({ limit: mockLimit }));
  const mockEq1 = vi.fn(() => ({ eq: mockEq2 }));
  const mockSelect = vi.fn(() => ({ eq: mockEq1 }));
  const mockFrom = vi.fn(() => ({ select: mockSelect }));
  const mockSchema = vi.fn(() => ({ from: mockFrom }));
  const mockSupabase = { schema: mockSchema };

  beforeEach(() => {
    vi.clearAllMocks();
    (createTenantServiceClient as any).mockResolvedValue(mockSupabase);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('resolves vault token and returns product list', async () => {
    mockSingle.mockResolvedValue({
      data: { config: { api_token_ref: 'vault:secret-id', shop_id: 'shop-123' }, provider_type: 'print_on_demand' },
    });
    (isVaultRef as any).mockReturnValue(true);
    (resolveProviderSecret as any).mockResolvedValue('real-token-abc');
    (listPrintifyProducts as any).mockResolvedValue(mockProducts);

    // Import handler (unwrapped by mock)
    const { GET } = await import('@/app/api/provisioning/providers/[id]/products/route');
    const handler = GET as any;

    const result = await handler({
      req: { url: 'http://localhost/api/provisioning/providers/prov-1/products' },
      session: { tenantId: 'tenant-1' },
      log: { info: vi.fn() },
    });

    expect(isVaultRef).toHaveBeenCalledWith('vault:secret-id');
    expect(resolveProviderSecret).toHaveBeenCalledWith(expect.anything(), 'vault:secret-id');
    expect(listPrintifyProducts).toHaveBeenCalledWith({ api_token: 'real-token-abc', shop_id: 'shop-123' });

    const body = await result.json();
    expect(body.data).toEqual(mockProducts);
    expect(body.data).toHaveLength(2);
  });

  it('uses raw token when not a vault ref', async () => {
    mockSingle.mockResolvedValue({
      data: { config: { api_token_ref: 'raw-token-xyz', shop_id: 'shop-456' }, provider_type: 'print_on_demand' },
    });
    (isVaultRef as any).mockReturnValue(false);
    (listPrintifyProducts as any).mockResolvedValue([]);

    const { GET } = await import('@/app/api/provisioning/providers/[id]/products/route');
    const handler = GET as any;

    await handler({
      req: { url: 'http://localhost/api/provisioning/providers/prov-2/products' },
      session: { tenantId: 'tenant-1' },
      log: { info: vi.fn() },
    });

    expect(resolveProviderSecret).not.toHaveBeenCalled();
    expect(listPrintifyProducts).toHaveBeenCalledWith({ api_token: 'raw-token-xyz', shop_id: 'shop-456' });
  });

  it('rejects non-print_on_demand providers', async () => {
    mockSingle.mockResolvedValue({
      data: { config: {}, provider_type: 'internal_warehouse' },
    });

    const { GET } = await import('@/app/api/provisioning/providers/[id]/products/route');
    const handler = GET as any;

    await expect(
      handler({
        req: { url: 'http://localhost/api/provisioning/providers/prov-3/products' },
        session: { tenantId: 'tenant-1' },
        log: { info: vi.fn() },
      }),
    ).rejects.toThrow('Product listing only available for print-on-demand providers');
  });

  it('throws not found when provider does not exist', async () => {
    mockSingle.mockResolvedValue({ data: null });

    const { GET } = await import('@/app/api/provisioning/providers/[id]/products/route');
    const handler = GET as any;

    await expect(
      handler({
        req: { url: 'http://localhost/api/provisioning/providers/missing/products' },
        session: { tenantId: 'tenant-1' },
        log: { info: vi.fn() },
      }),
    ).rejects.toThrow('Provider not found');
  });
});
