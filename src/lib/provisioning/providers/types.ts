/**
 * Provisioning Provider Abstraction
 *
 * Core interfaces for fulfillment providers. Each provider implements
 * FulfillmentProvider to handle order placement, status tracking, and
 * cancellation through a unified API.
 */

export interface ShippingAddress {
  name: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone?: string;
  email?: string;
}

export interface ProviderLineItem {
  lineId: string;
  catalogItemId: string;
  externalProductId: string;
  externalVariantId: string;
  qty: number;
  variantAttributes?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

export interface ProviderOrderRequest {
  tenantId: string;
  requestId: string;
  idempotencyKey: string;
  shippingAddress?: ShippingAddress;
  items: ProviderLineItem[];
  metadata?: Record<string, unknown>;
}

export interface ProviderOrderResult {
  success: boolean;
  externalOrderId?: string;
  estimatedDelivery?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  error?: string;
  lineResults?: Array<{
    lineId: string;
    externalOrderId?: string;
    status: string;
    error?: string;
  }>;
}

export interface ProviderStatusUpdate {
  externalOrderId: string;
  status: 'pending' | 'in_production' | 'shipped' | 'delivered' | 'cancelled' | 'failed';
  trackingNumber?: string;
  trackingUrl?: string;
  estimatedDelivery?: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderCostEstimate {
  totalCost: number;
  currency: string;
  lineEstimates: Array<{
    lineId: string;
    unitCost: number;
    qty: number;
    subtotal: number;
  }>;
  shippingCost?: number;
}

export type ProviderType = 'print_on_demand' | 'uniform_vendor' | 'internal_warehouse' | 'custom';

export interface ProviderConfig {
  id: string;
  tenantId: string;
  providerKey: string;
  displayName: string;
  providerType: ProviderType;
  config: Record<string, unknown>;
  capabilities: string[];
  priority: number;
  isActive: boolean;
}

/**
 * Core fulfillment provider interface.
 *
 * Each provider adapter (Printify, internal warehouse, etc.) implements
 * this interface. The orchestrator calls these methods through the registry.
 */
export interface FulfillmentProvider {
  readonly providerType: ProviderType;

  /** Place an order with the provider */
  placeOrder(request: ProviderOrderRequest, config: Record<string, unknown>): Promise<ProviderOrderResult>;

  /** Get current status of an existing order */
  getOrderStatus(externalOrderId: string, config: Record<string, unknown>): Promise<ProviderStatusUpdate>;

  /** Cancel an existing order */
  cancelOrder(externalOrderId: string, config: Record<string, unknown>): Promise<{ success: boolean; error?: string }>;

  /** Optional: estimate cost before placing order */
  estimateCost?(items: ProviderLineItem[], config: Record<string, unknown>): Promise<ProviderCostEstimate>;

  /** Validate provider configuration */
  validateConfig(config: Record<string, unknown>): Promise<{ valid: boolean; errors?: string[] }>;
}
