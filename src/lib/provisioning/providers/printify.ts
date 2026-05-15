/**
 * Printify Fulfillment Provider
 *
 * Implements the FulfillmentProvider interface for Printify print-on-demand
 * orders. Maps provisioning line items to Printify products/variants using
 * the provider_item_mappings table.
 */

import type {
  FulfillmentProvider,
  ProviderOrderRequest,
  ProviderOrderResult,
  ProviderStatusUpdate,
  ProviderLineItem,
  ProviderCostEstimate,
  ShippingAddress,
} from './types';
import { registerProvider } from './registry';
import {
  createPrintifyOrder,
  getPrintifyOrder,
  cancelPrintifyOrder,
  validatePrintifyConfig,
  type PrintifyConfig,
  type PrintifyAddress,
  type PrintifyLineItem,
} from './printify-client';

function toPrintifyAddress(addr: ShippingAddress): PrintifyAddress {
  const nameParts = addr.name.split(' ');
  return {
    first_name: nameParts[0] || '',
    last_name: nameParts.slice(1).join(' ') || '',
    email: addr.email,
    phone: addr.phone,
    country: addr.country,
    region: addr.state,
    address1: addr.address1,
    address2: addr.address2,
    city: addr.city,
    zip: addr.zip,
  };
}

function mapPrintifyStatus(status: string): ProviderStatusUpdate['status'] {
  switch (status.toLowerCase()) {
    case 'pending':
    case 'on-hold':
      return 'pending';
    case 'in-production':
    case 'has-issues':
      return 'in_production';
    case 'shipping':
    case 'shipped':
      return 'shipped';
    case 'delivered':
      return 'delivered';
    case 'canceled':
    case 'cancelled':
      return 'cancelled';
    default:
      return 'pending';
  }
}

export const printifyProvider: FulfillmentProvider = {
  providerType: 'print_on_demand',

  async placeOrder(request: ProviderOrderRequest, config: Record<string, unknown>): Promise<ProviderOrderResult> {
    const printifyConfig = config as unknown as PrintifyConfig;

    const lineItems: PrintifyLineItem[] = request.items
      .filter((item) => item.externalProductId && item.externalVariantId)
      .map((item) => ({
        product_id: item.externalProductId,
        variant_id: parseInt(item.externalVariantId, 10),
        quantity: item.qty,
      }));

    if (lineItems.length === 0) {
      return {
        success: false,
        error: 'No items have valid Printify product/variant mappings',
      };
    }

    const defaultAddress: PrintifyAddress = {
      first_name: 'Warehouse',
      last_name: 'Delivery',
      country: 'US',
      region: 'CA',
      address1: '123 Main St',
      city: 'Los Angeles',
      zip: '90001',
    };

    const address = request.shippingAddress
      ? toPrintifyAddress(request.shippingAddress)
      : defaultAddress;

    try {
      const order = await createPrintifyOrder(printifyConfig, {
        external_id: request.idempotencyKey,
        label: `Provision ${request.requestId}`,
        line_items: lineItems,
        shipping_method: 1, // Standard shipping
        address_to: address,
        send_shipping_notification: true,
      });

      return {
        success: true,
        externalOrderId: order.id,
        lineResults: request.items.map((item) => ({
          lineId: item.lineId,
          externalOrderId: order.id,
          status: 'ordered',
        })),
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message,
      };
    }
  },

  async getOrderStatus(externalOrderId: string, config: Record<string, unknown>): Promise<ProviderStatusUpdate> {
    const printifyConfig = config as unknown as PrintifyConfig;

    const order = await getPrintifyOrder(printifyConfig, externalOrderId);
    const shipment = order.shipments?.[0];

    return {
      externalOrderId,
      status: mapPrintifyStatus(order.status),
      trackingNumber: shipment?.number,
      trackingUrl: shipment?.url,
      metadata: { printify_status: order.status },
    };
  },

  async cancelOrder(externalOrderId: string, config: Record<string, unknown>): Promise<{ success: boolean; error?: string }> {
    const printifyConfig = config as unknown as PrintifyConfig;

    try {
      await cancelPrintifyOrder(printifyConfig, externalOrderId);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },

  async validateConfig(config: Record<string, unknown>): Promise<{ valid: boolean; errors?: string[] }> {
    const errors: string[] = [];
    const c = config as Record<string, string>;

    if (!c.api_token_ref) errors.push('api_token_ref is required');
    if (!c.shop_id) errors.push('shop_id is required');

    if (errors.length > 0) return { valid: false, errors };

    const result = await validatePrintifyConfig({
      api_token_ref: c.api_token_ref,
      shop_id: c.shop_id,
    });

    if (!result.valid) {
      return { valid: false, errors: [result.error ?? 'Validation failed'] };
    }

    return { valid: true };
  },
};

// Self-register when imported
registerProvider('print_on_demand', printifyProvider);
