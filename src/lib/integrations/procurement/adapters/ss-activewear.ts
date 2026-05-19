/**
 * S&S Activewear Procurement Adapter
 *
 * Real implementation against the S&S Activewear REST/JSON API (V2).
 * Uses HTTP Basic Auth (account_number:api_key).
 * Covers Bella+Canvas, Next Level, Gildan, Comfort Colors,
 * Independent Trading, Allmade, alphabroder brands.
 *
 * API docs: https://api.ssactivewear.com/V2
 */

import { AppError } from '@rocketmanv9/chassis/errors';
import type {
  ProcurementProviderAdapter,
  ProcurementProviderConfig,
  ProcurementAdapterMeta,
  ConnectionValidation,
  ExternalProduct,
  ExternalProductVariant,
  SubmitOrderInput,
  SubmitOrderResult,
  ExternalOrderStatus,
} from '../types';

// ── Constants ────────────────────────────────────────────────────────

const BASE_URL = 'https://api.ssactivewear.com/V2';

// ── Helpers ──────────────────────────────────────────────────────────

function buildAuthHeader(config: ProcurementProviderConfig): string {
  const account = config.credentials.account_number || config.settings.account_number;
  const apiKey = config.credentials.api_key || config.settings.api_key;
  if (!account || !apiKey) {
    throw AppError.badRequest('Missing S&S Activewear account_number or api_key');
  }
  return 'Basic ' + Buffer.from(`${account}:${apiKey}`).toString('base64');
}

async function ssRequest<T>(
  config: ProcurementProviderConfig,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: buildAuthHeader(config),
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers as Record<string, string> | undefined),
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw AppError.internal(
      `S&S Activewear API error ${response.status}: ${body || response.statusText}`,
    );
  }

  return response.json() as Promise<T>;
}

// ── S&S API Response Types (subset) ──────────────────────────────────

interface SSProduct {
  styleID?: number;
  styleName?: string;
  title?: string;
  brandName?: string;
  colorName?: string;
  sizeName?: string;
  sku?: string;
  gtin?: string;
  styleImage?: string;
  brandImage?: string;
  colorFrontImage?: string;
  piecePrice?: number;
  casePrice?: number;
  salePrice?: number;
  qty?: number;
  customerPrice?: number;
}

interface SSOrderResponse {
  poNumber?: string;
  orderNumber?: string;
  status?: string;
  message?: string;
  estimatedShipDate?: string;
}

interface SSOrderStatus {
  poNumber?: string;
  orderNumber?: string;
  status?: string;
  trackingNumber?: string;
  trackingURL?: string;
  estimatedShipDate?: string;
  shipDate?: string;
  lines?: SSOrderLine[];
}

interface SSOrderLine {
  sku?: string;
  qty?: number;
  qtyShipped?: number;
  trackingNumber?: string;
}

// ── Adapter Metadata ─────────────────────────────────────────────────

const META: ProcurementAdapterMeta = {
  key: 'ss-activewear',
  displayName: 'S&S Activewear',
  description:
    'Order blank apparel and accessories from S&S Activewear — Bella+Canvas, Next Level, Gildan, Comfort Colors, Independent Trading, and more.',
  providerType: 'procurement_distributor',
  iconLetter: 'S',
  iconColor: 'blue',
  authMethod: 'credentials',
  configFields: [
    {
      key: 'account_number',
      label: 'Account Number',
      type: 'text',
      required: true,
      placeholder: 'Your S&S Activewear account number',
      helpText: 'Found in your S&S Activewear account settings.',
    },
    {
      key: 'api_key',
      label: 'API Key',
      type: 'password',
      required: true,
      placeholder: 'Your S&S Activewear API key',
      helpText: 'Stored securely in Vault — never exposed to the frontend.',
    },
  ],
  capabilities: ['sku_lookup', 'order_placement', 'order_tracking', 'order_cancellation'],
  docsUrl: 'https://api.ssactivewear.com/V2',
};

// ── Adapter Implementation ───────────────────────────────────────────

export const ssActivewearAdapter: ProcurementProviderAdapter = {
  meta: META,

  async validateConnection(config: ProcurementProviderConfig): Promise<ConnectionValidation> {
    try {
      // Quick test: look up a well-known style (Hanes PC54)
      const products = await ssRequest<SSProduct[]>(
        config,
        '/Products/?style=PC54&mediatype=json',
      );
      return {
        valid: true,
        message: `Connected to S&S Activewear — ${products.length} variant(s) found for test style PC54`,
        accountInfo: {
          testStyleFound: true,
          variantsReturned: products.length,
        },
      };
    } catch (err) {
      const message =
        err instanceof AppError ? err.message : 'Unable to connect to S&S Activewear';
      return {
        valid: false,
        message,
      };
    }
  },

  async lookupProduct(
    config: ProcurementProviderConfig,
    externalProductId: string,
  ): Promise<ExternalProduct | null> {
    try {
      const products = await ssRequest<SSProduct[]>(
        config,
        `/Products/?style=${encodeURIComponent(externalProductId)}&mediatype=json`,
      );

      if (!products || products.length === 0) return null;

      // First item provides the style-level info; all items are color/size variants
      const first = products[0];

      const variants: ExternalProductVariant[] = products.map((p) => ({
        variantId: p.sku || `${p.styleID}-${p.colorName}-${p.sizeName}`,
        title: [p.colorName, p.sizeName].filter(Boolean).join(' / '),
        price: p.customerPrice ?? p.piecePrice ?? 0,
        sku: p.sku,
        inStock: (p.qty ?? 0) > 0,
        attributes: {
          ...(p.colorName ? { color: p.colorName } : {}),
          ...(p.sizeName ? { size: p.sizeName } : {}),
          ...(p.gtin ? { gtin: p.gtin } : {}),
        },
      }));

      return {
        externalProductId: String(first.styleID ?? externalProductId),
        title: first.styleName || first.title || externalProductId,
        description: `${first.brandName || ''} ${first.styleName || ''}`.trim(),
        imageUrl: first.colorFrontImage || first.styleImage || undefined,
        price: first.customerPrice ?? first.piecePrice ?? 0,
        currency: 'USD',
        brand: first.brandName || undefined,
        sku: first.sku || undefined,
        inStock: products.some((p) => (p.qty ?? 0) > 0),
        variants,
        attributes: {
          variantCount: String(variants.length),
        },
      };
    } catch (err) {
      if (err instanceof AppError && err.message.includes('404')) return null;
      throw err;
    }
  },

  async submitOrder(
    config: ProcurementProviderConfig,
    order: SubmitOrderInput,
  ): Promise<SubmitOrderResult> {
    const body = {
      po: order.internalOrderId,
      shipTo: {
        name: order.shippingAddress.name,
        company: order.shippingAddress.company || '',
        address1: order.shippingAddress.address1,
        address2: order.shippingAddress.address2 || '',
        city: order.shippingAddress.city,
        state: order.shippingAddress.state,
        zip: order.shippingAddress.postalCode,
        country: order.shippingAddress.country,
        phone: order.shippingAddress.phone || '',
        email: order.shippingAddress.email || '',
      },
      lines: order.lineItems.map((item) => ({
        sku: item.variantId || item.externalProductId,
        qty: item.quantity,
      })),
      notes: order.notes || '',
    };

    const result = await ssRequest<SSOrderResponse>(config, '/Orders/', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    return {
      externalOrderId: result.orderNumber || result.poNumber || order.internalOrderId,
      status: result.status || 'submitted',
      confirmationNumber: result.orderNumber || undefined,
      estimatedDelivery: result.estimatedShipDate || undefined,
      rawResponse: result as unknown as Record<string, unknown>,
    };
  },

  async getOrderStatus(
    config: ProcurementProviderConfig,
    externalOrderId: string,
  ): Promise<ExternalOrderStatus> {
    const results = await ssRequest<SSOrderStatus[]>(
      config,
      `/Orders/?po=${encodeURIComponent(externalOrderId)}&mediatype=json`,
    );

    const order = results?.[0];
    if (!order) {
      throw AppError.notFound(`S&S Activewear order not found: ${externalOrderId}`);
    }

    const trackingNumbers = [
      order.trackingNumber,
      ...(order.lines?.map((l) => l.trackingNumber).filter(Boolean) || []),
    ].filter((v): v is string => !!v);

    return {
      externalOrderId: order.poNumber || order.orderNumber || externalOrderId,
      status: order.status || 'unknown',
      statusDetail: order.shipDate
        ? `Shipped on ${order.shipDate}`
        : order.estimatedShipDate
          ? `Estimated ship date: ${order.estimatedShipDate}`
          : undefined,
      items: order.lines?.map((line) => ({
        externalProductId: line.sku || '',
        quantity: line.qty || 0,
        quantityShipped: line.qtyShipped || 0,
        quantityDelivered: 0,
        trackingNumber: line.trackingNumber || undefined,
      })),
      trackingNumbers: [...new Set(trackingNumbers)],
      updatedAt: new Date().toISOString(),
      rawResponse: order as unknown as Record<string, unknown>,
    };
  },

  async cancelOrder(
    config: ProcurementProviderConfig,
    externalOrderId: string,
  ): Promise<{ success: boolean; message?: string }> {
    try {
      await ssRequest<unknown>(
        config,
        `/Orders/?po=${encodeURIComponent(externalOrderId)}&mediatype=json`,
        { method: 'DELETE' },
      );
      return {
        success: true,
        message: `Order ${externalOrderId} cancellation requested`,
      };
    } catch (err) {
      const message =
        err instanceof AppError ? err.message : 'Failed to cancel order';
      return {
        success: false,
        message,
      };
    }
  },
};
