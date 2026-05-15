/**
 * Internal Warehouse Provider
 *
 * Fulfills provisioning lines from existing inventory stock using
 * the inventory reservation RPCs. No external API calls needed.
 */

import type {
  FulfillmentProvider,
  ProviderOrderRequest,
  ProviderOrderResult,
  ProviderStatusUpdate,
  ProviderLineItem,
  ProviderCostEstimate,
} from './types';
import { registerProvider } from './registry';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';

async function getInventoryClient(tenantId: string) {
  return createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });
}

export const internalWarehouseProvider: FulfillmentProvider = {
  providerType: 'internal_warehouse',

  async placeOrder(request: ProviderOrderRequest, _config: Record<string, unknown>): Promise<ProviderOrderResult> {
    const supabase = await getInventoryClient(request.tenantId);
    const inv = (supabase as any).schema('inventory');

    const lineResults: ProviderOrderResult['lineResults'] = [];
    let allSuccess = true;

    for (const item of request.items) {
      // Find a location with available stock
      const { data: balances } = await inv
        .from('stock_balances')
        .select('location_id, qty_available')
        .eq('catalog_item_id', item.catalogItemId)
        .gt('qty_available', item.qty - 1) // gte qty needed
        .order('qty_available', { ascending: false })
        .limit(1);

      const locationId = balances?.[0]?.location_id;

      if (!locationId) {
        lineResults?.push({
          lineId: item.lineId,
          status: 'backordered',
          error: 'No stock available at any location',
        });
        allSuccess = false;
        continue;
      }

      // Reserve stock via inventory RPC
      const idempotencyKey = `prov-order-${request.tenantId}-${item.lineId}`;
      const { error: reserveError } = await inv
        .rpc('rpc_inv_reserve_fungible', {
          p_catalog_item_id: item.catalogItemId,
          p_location_id: locationId,
          p_qty: item.qty,
          p_allocation_type: 'person',
          p_job_ref: `Provisioning Request ${request.requestId}`,
          p_notes: `Auto-reserved for provisioning line ${item.lineId}`,
          p_last_event_id: idempotencyKey,
        });

      if (reserveError) {
        lineResults?.push({
          lineId: item.lineId,
          status: 'failed',
          error: reserveError.message,
        });
        allSuccess = false;
      } else {
        lineResults?.push({
          lineId: item.lineId,
          externalOrderId: idempotencyKey,
          status: 'reserved',
        });
      }
    }

    return {
      success: allSuccess,
      externalOrderId: `internal-${request.requestId}`,
      lineResults,
    };
  },

  async getOrderStatus(externalOrderId: string, _config: Record<string, unknown>): Promise<ProviderStatusUpdate> {
    // Internal warehouse orders are immediately available once reserved.
    // Status is managed directly via provisioning_lines table.
    return {
      externalOrderId,
      status: 'delivered',
    };
  },

  async cancelOrder(externalOrderId: string, _config: Record<string, unknown>): Promise<{ success: boolean; error?: string }> {
    // Cancellation of internal warehouse reservations is handled by
    // releasing the inventory reservation directly. The orchestrator
    // handles that through the inventory RPC layer.
    return { success: true };
  },

  async estimateCost(items: ProviderLineItem[], _config: Record<string, unknown>): Promise<ProviderCostEstimate> {
    // Internal warehouse items have no fulfillment cost
    return {
      totalCost: 0,
      currency: 'USD',
      lineEstimates: items.map((item) => ({
        lineId: item.lineId,
        unitCost: 0,
        qty: item.qty,
        subtotal: 0,
      })),
    };
  },

  async validateConfig(_config: Record<string, unknown>): Promise<{ valid: boolean; errors?: string[] }> {
    // Internal warehouse requires no special configuration
    return { valid: true };
  },
};

// Self-register when imported
registerProvider('internal_warehouse', internalWarehouseProvider);
