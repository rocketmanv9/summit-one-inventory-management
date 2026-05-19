/**
 * Procurement Provider Abstraction Layer — Types
 *
 * Defines the interfaces that all procurement providers must implement.
 * The adapter pattern allows Amazon Business, Grainger, and future providers
 * to be swapped in/out behind a unified API.
 */

// ── Provider Config ───────────────────────────────────────────────────

/** Resolved config from Vault + provisioning.providers table */
export interface ProcurementProviderConfig {
  providerId: string;
  tenantId: string;
  providerKey: string;
  displayName: string;
  providerType: 'procurement_marketplace' | 'procurement_distributor' | 'procurement_direct';
  isActive: boolean;
  /** Provider-specific config resolved from provisioning.providers.config */
  settings: Record<string, unknown>;
  /** Resolved secrets from Vault (API keys, OAuth tokens, etc.) */
  credentials: Record<string, string>;
}

// ── Product Types ─────────────────────────────────────────────────────

export interface ExternalProduct {
  externalProductId: string;
  title: string;
  description: string;
  imageUrl?: string;
  price: number;
  currency: string;
  category?: string;
  brand?: string;
  sku?: string;
  inStock: boolean;
  variants?: ExternalProductVariant[];
  attributes?: Record<string, string>;
}

export interface ExternalProductVariant {
  variantId: string;
  title: string;
  price: number;
  sku?: string;
  inStock: boolean;
  attributes?: Record<string, string>;
}

// ── Order Types ───────────────────────────────────────────────────────

export interface SubmitOrderLineItem {
  externalProductId: string;
  variantId?: string;
  quantity: number;
  unitPrice: number;
}

export interface SubmitOrderInput {
  /** Internal order ID for cross-referencing */
  internalOrderId: string;
  lineItems: SubmitOrderLineItem[];
  shippingAddress: OrderAddress;
  billingAddress?: OrderAddress;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface OrderAddress {
  name: string;
  company?: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone?: string;
  email?: string;
}

export interface SubmitOrderResult {
  externalOrderId: string;
  status: string;
  confirmationNumber?: string;
  estimatedDelivery?: string;
  rawResponse?: Record<string, unknown>;
}

export interface ExternalOrderStatus {
  externalOrderId: string;
  status: string;
  statusDetail?: string;
  items?: ExternalOrderItemStatus[];
  trackingNumbers?: string[];
  updatedAt: string;
  rawResponse?: Record<string, unknown>;
}

export interface ExternalOrderItemStatus {
  externalProductId: string;
  quantity: number;
  quantityShipped: number;
  quantityDelivered: number;
  trackingNumber?: string;
  trackingUrl?: string;
}

// ── OAuth Types ───────────────────────────────────────────────────────

export interface OAuthUrlResult {
  url: string;
  state: string;
}

export interface OAuthTokenResult {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  tokenType: string;
  scope?: string;
}

// ── Connection Types ──────────────────────────────────────────────────

export interface ConnectionValidation {
  valid: boolean;
  message?: string;
  accountInfo?: Record<string, unknown>;
}

// ── Adapter Metadata ──────────────────────────────────────────────────

export interface ProcurementAdapterMeta {
  key: string;
  displayName: string;
  description: string;
  providerType: ProcurementProviderConfig['providerType'];
  iconLetter: string;
  iconColor: string;
  authMethod: 'api_key' | 'oauth2' | 'credentials';
  configFields: AdapterConfigField[];
  capabilities: string[];
  docsUrl?: string;
}

export interface AdapterConfigField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'url';
  required: boolean;
  placeholder?: string;
  helpText?: string;
}

// ── Adapter Interface ─────────────────────────────────────────────────

/** Interface that all procurement provider adapters must implement */
export interface ProcurementProviderAdapter {
  /** Static metadata about this adapter */
  meta: ProcurementAdapterMeta;

  // ── Connection Management ───────────────────────────────────────
  validateConnection(config: ProcurementProviderConfig): Promise<ConnectionValidation>;
  getOAuthUrl?(config: ProcurementProviderConfig, redirectUri: string): Promise<OAuthUrlResult>;
  exchangeOAuthCode?(config: ProcurementProviderConfig, code: string, redirectUri: string): Promise<OAuthTokenResult>;
  refreshOAuthToken?(config: ProcurementProviderConfig): Promise<OAuthTokenResult>;

  // ── SKU Lookup (replaces product search) ──────────────────────
  /** Verify a mapped external product ID exists and get current price/availability */
  lookupProduct(config: ProcurementProviderConfig, externalProductId: string): Promise<ExternalProduct | null>;

  // ── Order Management ────────────────────────────────────────────
  submitOrder(config: ProcurementProviderConfig, order: SubmitOrderInput): Promise<SubmitOrderResult>;
  getOrderStatus(config: ProcurementProviderConfig, externalOrderId: string): Promise<ExternalOrderStatus>;
  cancelOrder(config: ProcurementProviderConfig, externalOrderId: string): Promise<{ success: boolean; message?: string }>;

  // ── Order History ───────────────────────────────────────────────
  listRecentOrders?(config: ProcurementProviderConfig, limit?: number): Promise<ExternalOrderStatus[]>;
}

// ── Domain Types ──────────────────────────────────────────────────────

export interface ReorderRule {
  id: string;
  tenant_id: string;
  catalog_item_id: string;
  item_name: string;
  reorder_point: number;
  reorder_qty: number;
  max_stock: number | null;
  preferred_provider_id: string | null;
  external_product_id: string | null;
  external_variant_id: string | null;
  unit_cost: number | null;
  auto_reorder: boolean;
  max_auto_amount: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

