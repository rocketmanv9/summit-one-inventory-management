/**
 * Printify Fulfillment Provider
 *
 * Implements the FulfillmentProvider interface for Printify print-on-demand
 * orders. Maps provisioning line items to Printify products/variants using
 * the provider_item_mappings table.
 *
 * All API tokens are resolved from Supabase Vault at call time —
 * the config.api_token_ref stored in the DB is a vault reference name,
 * never a plaintext token.
 */

import type {
  FulfillmentProvider,
  ProviderOrderRequest,
  ProviderOrderResult,
  ProviderStatusUpdate,
  ShippingAddress,
} from './types';
import { registerProvider } from './registry';
import {
  createPrintifyOrder,
  getPrintifyOrder,
  cancelPrintifyOrder,
  validatePrintifyConfig,
  type PrintifyConfig,
  type PrintifyResolvedConfig,
  type PrintifyAddress,
  type PrintifyLineItem,
} from './printify-client';
import { resolveProviderSecret, isVaultRef } from './secrets';
import { getAdminClient } from '@/utils/supabase/admin';

/**
 * Resolve a PrintifyConfig (with vault ref) into a PrintifyResolvedConfig
 * (with real API token).
 */
async function resolveConfig(config: PrintifyConfig): Promise<PrintifyResolvedConfig> {
  const supabase = getAdminClient();
  let apiToken: string;

  if (isVaultRef(config.api_token_ref)) {
    apiToken = await resolveProviderSecret(supabase, config.api_token_ref);
  } else {
    // Legacy plaintext token (pre-migration) — use directly
    apiToken = config.api_token_ref;
  }

  return { api_token: apiToken, shop_id: config.shop_id };
}

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

/**
 * Build the Printify order payload without submitting it.
 * Used by the orchestrator for dry-run previews and by placeOrder for actual submission.
 */
export function buildPrintifyOrderPayload(
  request: ProviderOrderRequest,
  config: { shop_id: string },
): { line_items: PrintifyLineItem[]; address: PrintifyAddress | null; label: string; external_id: string } | { error: string } {
  const lineItems: PrintifyLineItem[] = request.items
    .filter((item) => item.externalProductId && item.externalVariantId)
    .map((item) => ({
      product_id: item.externalProductId,
      variant_id: parseInt(item.externalVariantId, 10),
      quantity: item.qty,
    }));

  if (lineItems.length === 0) {
    return { error: 'No items have valid Printify product/variant mappings' };
  }

  const address = request.shippingAddress ? toPrintifyAddress(request.shippingAddress) : null;

  return {
    line_items: lineItems,
    address,
    label: `Provision ${request.requestId}`,
    external_id: request.idempotencyKey,
  };
}

export const printifyProvider: FulfillmentProvider = {
  providerType: 'print_on_demand',

  async placeOrder(request: ProviderOrderRequest, config: Record<string, unknown>): Promise<ProviderOrderResult> {
    const printifyConfig = config as unknown as PrintifyConfig;
    const resolved = await resolveConfig(printifyConfig);

    const payload = buildPrintifyOrderPayload(request, { shop_id: resolved.shop_id });

    if ('error' in payload) {
      return { success: false, error: payload.error };
    }

    if (!payload.address) {
      return {
        success: false,
        error: 'Shipping address is required for Printify orders. Configure a default ship-to location or provide an address on the request.',
      };
    }

    try {
      const order = await createPrintifyOrder(resolved, {
        external_id: payload.external_id,
        label: payload.label,
        line_items: payload.line_items,
        shipping_method: 1, // Standard shipping
        address_to: payload.address,
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
    const resolved = await resolveConfig(printifyConfig);

    const order = await getPrintifyOrder(resolved, externalOrderId);
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
    const resolved = await resolveConfig(printifyConfig);

    try {
      await cancelPrintifyOrder(resolved, externalOrderId);
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

    const resolved = await resolveConfig({
      api_token_ref: c.api_token_ref,
      shop_id: c.shop_id,
    });

    const result = await validatePrintifyConfig(resolved);

    if (!result.valid) {
      return { valid: false, errors: [result.error ?? 'Validation failed'] };
    }

    return { valid: true };
  },
};

// Self-register when imported
registerProvider('print_on_demand', printifyProvider);
