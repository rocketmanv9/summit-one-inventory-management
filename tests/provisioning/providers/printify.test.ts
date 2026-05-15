import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.spyOn(console, 'log').mockImplementation(() => {});

// Mock the printify-client module
vi.mock('../../../src/lib/provisioning/providers/printify-client', () => ({
  createPrintifyOrder: vi.fn(),
  getPrintifyOrder: vi.fn(),
  cancelPrintifyOrder: vi.fn(),
  validatePrintifyConfig: vi.fn(),
}));

// Mock registry to prevent side effects
vi.mock('../../../src/lib/provisioning/providers/registry', () => ({
  registerProvider: vi.fn(),
}));

import { createPrintifyOrder, getPrintifyOrder, cancelPrintifyOrder, validatePrintifyConfig } from '../../../src/lib/provisioning/providers/printify-client';
import { printifyProvider } from '../../../src/lib/provisioning/providers/printify';

describe('printifyProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has correct provider type', () => {
    expect(printifyProvider.providerType).toBe('print_on_demand');
  });

  it('places order successfully with mapped items', async () => {
    (createPrintifyOrder as any).mockResolvedValue({
      id: 'printify-order-123',
      external_id: 'key-1',
      status: 'pending',
    });

    const result = await printifyProvider.placeOrder(
      {
        tenantId: 'tenant-1',
        requestId: 'req-1',
        idempotencyKey: 'key-1',
        items: [{
          lineId: 'line-1',
          catalogItemId: 'item-1',
          externalProductId: 'product-abc',
          externalVariantId: '12345',
          qty: 2,
        }],
        shippingAddress: {
          name: 'John Doe',
          address1: '123 Main St',
          city: 'Phoenix',
          state: 'AZ',
          zip: '85001',
          country: 'US',
        },
      },
      { api_token_ref: 'token', shop_id: 'shop-1' },
    );

    expect(result.success).toBe(true);
    expect(result.externalOrderId).toBe('printify-order-123');
    expect(createPrintifyOrder).toHaveBeenCalledOnce();
  });

  it('fails when no items have mappings', async () => {
    const result = await printifyProvider.placeOrder(
      {
        tenantId: 'tenant-1',
        requestId: 'req-1',
        idempotencyKey: 'key-1',
        items: [{
          lineId: 'line-1',
          catalogItemId: 'item-1',
          externalProductId: '',
          externalVariantId: '',
          qty: 1,
        }],
      },
      { api_token_ref: 'token', shop_id: 'shop-1' },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('No items have valid Printify product/variant mappings');
  });

  it('gets order status and maps correctly', async () => {
    (getPrintifyOrder as any).mockResolvedValue({
      id: 'order-123',
      status: 'in-production',
      shipments: [{ number: 'TRACK123', url: 'https://track.example.com' }],
    });

    const status = await printifyProvider.getOrderStatus(
      'order-123',
      { api_token_ref: 'token', shop_id: 'shop-1' },
    );

    expect(status.status).toBe('in_production');
    expect(status.trackingNumber).toBe('TRACK123');
  });

  it('cancels order successfully', async () => {
    (cancelPrintifyOrder as any).mockResolvedValue(undefined);

    const result = await printifyProvider.cancelOrder(
      'order-123',
      { api_token_ref: 'token', shop_id: 'shop-1' },
    );

    expect(result.success).toBe(true);
  });

  it('validates config requires api_token_ref and shop_id', async () => {
    const result = await printifyProvider.validateConfig({});
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('api_token_ref is required');
    expect(result.errors).toContain('shop_id is required');
  });

  it('validates config calls Printify API when fields present', async () => {
    (validatePrintifyConfig as any).mockResolvedValue({ valid: true, shopName: 'My Shop' });

    const result = await printifyProvider.validateConfig({
      api_token_ref: 'token-abc',
      shop_id: 'shop-123',
    });

    expect(result.valid).toBe(true);
    expect(validatePrintifyConfig).toHaveBeenCalledWith({
      api_token_ref: 'token-abc',
      shop_id: 'shop-123',
    });
  });
});
