/**
 * Amazon Business Procurement Adapter (Stub)
 *
 * Stubbed implementation returning realistic mock data for development.
 * Will be replaced with real SP-API calls once credentials are available.
 */

import type {
  ProcurementProviderAdapter,
  ProcurementProviderConfig,
  ProcurementAdapterMeta,
  ConnectionValidation,
  OAuthUrlResult,
  OAuthTokenResult,
  ExternalProduct,
  SubmitOrderInput,
  SubmitOrderResult,
  ExternalOrderStatus,
} from '../types';

// ── Mock Product Catalog (used for lookupProduct stub) ───────────────

const MOCK_PRODUCTS: ExternalProduct[] = [
  {
    externalProductId: 'AMZ-B07DFGKLYH',
    title: '3M Reflective Safety Vest - Class 2, High Visibility, Yellow/Lime',
    description: 'ANSI/ISEA 107-2015 Type R Class 2 compliant. 360-degree reflectivity with 2-inch silver reflective tape.',
    price: 12.99,
    currency: 'USD',
    category: 'Safety Equipment',
    brand: '3M',
    sku: '3M-SV-CL2-YL',
    inStock: true,
  },
  {
    externalProductId: 'AMZ-B073WRHKG3',
    title: 'Mechanix Wear - Original Work Gloves (Large, Black)',
    description: 'Form-fitting TrekDry material keeps hands cool and comfortable.',
    price: 21.49,
    currency: 'USD',
    category: 'Hand Protection',
    brand: 'Mechanix Wear',
    sku: 'MX-OG-BK',
    inStock: true,
  },
  {
    externalProductId: 'AMZ-B000RMDPUU',
    title: 'Hard Hat - OSHA Approved, Type I Class E, 4-Point Suspension',
    description: 'MSA V-Gard cap style hard hat. Fas-Trac III ratchet suspension.',
    price: 18.75,
    currency: 'USD',
    category: 'Head Protection',
    brand: 'MSA Safety',
    sku: 'MSA-VG-WHT',
    inStock: true,
  },
  {
    externalProductId: 'AMZ-B00AZLHHOS',
    title: 'Safety Glasses - Anti-Fog, Scratch-Resistant, ANSI Z87.1',
    description: 'Uvex Stealth OTG safety goggles. Fits over prescription glasses.',
    price: 9.50,
    currency: 'USD',
    category: 'Eye Protection',
    brand: 'Uvex by Honeywell',
    sku: 'UVX-S3960C',
    inStock: true,
  },
  {
    externalProductId: 'AMZ-B002UXRJMS',
    title: 'Ear Plugs - NRR 33dB, 200-Pair Box, Foam',
    description: '3M E-A-R Classic ear plugs. Cylindrical shape for easy insertion.',
    price: 32.99,
    currency: 'USD',
    category: 'Hearing Protection',
    brand: '3M',
    sku: '3M-EAR-200',
    inStock: true,
  },
];

// ── Adapter Metadata ──────────────────────────────────────────────────

const META: ProcurementAdapterMeta = {
  key: 'amazon-business',
  displayName: 'Amazon Business',
  description: 'Order safety equipment, tools, and supplies from Amazon Business with business pricing and tax-exempt purchasing.',
  providerType: 'procurement_marketplace',
  iconLetter: 'A',
  iconColor: 'orange',
  authMethod: 'oauth2',
  configFields: [
    {
      key: 'client_id',
      label: 'Client ID',
      type: 'text',
      required: true,
      placeholder: 'amzn1.application-oa2-client.abc...',
      helpText: 'Your Amazon Business API Client ID from Seller Central.',
    },
    {
      key: 'client_secret',
      label: 'Client Secret',
      type: 'password',
      required: true,
      placeholder: 'Your client secret',
      helpText: 'Stored securely in Vault — never exposed to the frontend.',
    },
  ],
  capabilities: ['sku_lookup', 'order_placement', 'order_tracking', 'bulk_pricing'],
  docsUrl: 'https://developer.amazon.com/docs/amazon-business/ab-overview.html',
};

// ── Stub Adapter Implementation ───────────────────────────────────────

export const amazonBusinessAdapter: ProcurementProviderAdapter = {
  meta: META,

  async validateConnection(_config: ProcurementProviderConfig): Promise<ConnectionValidation> {
    return {
      valid: true,
      message: 'Connected to Amazon Business (stub mode)',
      accountInfo: {
        accountName: 'Summit One LLC',
        accountType: 'Business',
        marketplace: 'US',
      },
    };
  },

  async getOAuthUrl(_config: ProcurementProviderConfig, redirectUri: string): Promise<OAuthUrlResult> {
    const state = crypto.randomUUID();
    const clientId = _config.settings.client_id || 'stub-client-id';
    const url = `https://www.amazon.com/ap/oa?client_id=${clientId}&scope=profile&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
    return { url, state };
  },

  async exchangeOAuthCode(_config: ProcurementProviderConfig, _code: string, _redirectUri: string): Promise<OAuthTokenResult> {
    return {
      accessToken: 'stub-access-token-' + crypto.randomUUID().slice(0, 8),
      refreshToken: 'stub-refresh-token-' + crypto.randomUUID().slice(0, 8),
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      tokenType: 'Bearer',
      scope: 'profile',
    };
  },

  async refreshOAuthToken(_config: ProcurementProviderConfig): Promise<OAuthTokenResult> {
    return {
      accessToken: 'stub-refreshed-token-' + crypto.randomUUID().slice(0, 8),
      refreshToken: 'stub-refresh-token-' + crypto.randomUUID().slice(0, 8),
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      tokenType: 'Bearer',
      scope: 'profile',
    };
  },

  async lookupProduct(_config: ProcurementProviderConfig, externalProductId: string): Promise<ExternalProduct | null> {
    // Stub: look up in mock catalog by external product ID
    return MOCK_PRODUCTS.find((p) => p.externalProductId === externalProductId) || null;
  },

  async submitOrder(_config: ProcurementProviderConfig, order: SubmitOrderInput): Promise<SubmitOrderResult> {
    const externalOrderId = 'AMZ-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomUUID().slice(0, 4).toUpperCase();

    return {
      externalOrderId,
      status: 'confirmed',
      confirmationNumber: externalOrderId,
      estimatedDelivery: new Date(Date.now() + 5 * 86400 * 1000).toISOString().split('T')[0],
      rawResponse: {
        stub: true,
        internalOrderId: order.internalOrderId,
        itemCount: order.lineItems.length,
      },
    };
  },

  async getOrderStatus(_config: ProcurementProviderConfig, externalOrderId: string): Promise<ExternalOrderStatus> {
    return {
      externalOrderId,
      status: 'processing',
      statusDetail: 'Order is being prepared for shipment',
      trackingNumbers: [],
      updatedAt: new Date().toISOString(),
      rawResponse: { stub: true },
    };
  },

  async cancelOrder(_config: ProcurementProviderConfig, externalOrderId: string): Promise<{ success: boolean; message?: string }> {
    return {
      success: true,
      message: `Order ${externalOrderId} cancelled successfully (stub)`,
    };
  },

  async listRecentOrders(_config: ProcurementProviderConfig, limit = 10): Promise<ExternalOrderStatus[]> {
    return Array.from({ length: Math.min(limit, 3) }, (_, i) => ({
      externalOrderId: `AMZ-STUB-${1000 + i}`,
      status: ['delivered', 'shipped', 'processing'][i] || 'processing',
      statusDetail: ['Delivered on May 15', 'In transit - estimated May 20', 'Preparing for shipment'][i],
      trackingNumbers: i === 1 ? ['1Z999AA10123456784'] : [],
      updatedAt: new Date(Date.now() - i * 86400 * 1000).toISOString(),
    }));
  },
};
