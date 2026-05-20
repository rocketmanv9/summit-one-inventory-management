/**
 * Amazon Business API Client
 *
 * Standalone HTTP client for Amazon Business integration.
 * Handles OAuth token management (LWA), product search, cart/order placement,
 * and config resolution from Vault.
 */

import { AppError } from '@rocketmanv9/chassis/errors';

// ── Types ──────────────────────────────────────────────────────────────

export interface AmazonBusinessConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  applicationId?: string;
}

export interface AmazonProduct {
  asin: string;
  title: string;
  price?: { amount: number; currency: string };
  availability?: string;
  imageUrl?: string;
  [key: string]: unknown;
}

export interface AmazonShippingAddress {
  name: string;
  address_line_1: string;
  address_line_2?: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
}

export interface AmazonCartItem {
  asin: string;
  quantity: number;
}

export interface AmazonCostEstimate {
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
  currency: string;
  items: Array<{ asin: string; unit_price: number; quantity: number; line_total: number }>;
}

export interface AmazonOrder {
  amazon_order_id: string;
  cart_id?: string;
  status: string;
  items: AmazonCartItem[];
  shipping_address: AmazonShippingAddress;
  cost_estimate?: AmazonCostEstimate;
  total_cost?: number;
  tracking_info?: {
    carrier?: string;
    tracking_number?: string;
    estimated_delivery?: string;
  };
  [key: string]: unknown;
}

// ── Token Management ───────────────────────────────────────────────────

const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const AMAZON_BUSINESS_BASE = 'https://na.business-api.amazon.com';

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

/**
 * Refresh the LWA access token. Caches with ~55min TTL.
 */
export async function refreshAccessToken(config: AmazonBusinessConfig): Promise<string> {
  const cacheKey = `${config.clientId}:${config.refreshToken.slice(-8)}`;
  const cached = tokenCache.get(cacheKey);

  if (cached && Date.now() < cached.expiresAt) {
    return cached.accessToken;
  }

  const res = await fetch(LWA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => 'unknown error');
    throw AppError.internal(`Amazon LWA token refresh failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  const accessToken = data.access_token as string;
  const expiresIn = (data.expires_in as number) || 3600;

  // Cache with 5-minute buffer
  tokenCache.set(cacheKey, {
    accessToken,
    expiresAt: Date.now() + (expiresIn - 300) * 1000,
  });

  return accessToken;
}

// ── HTTP Helper ────────────────────────────────────────────────────────

async function amazonBusinessFetch(
  config: AmazonBusinessConfig,
  path: string,
  options: RequestInit = {},
  retries = 3
): Promise<Response> {
  const accessToken = await refreshAccessToken(config);
  const url = `${AMAZON_BUSINESS_BASE}${path}`;

  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'x-amz-user-email': '', // Required header — populated at call site if needed
        ...options.headers,
      },
    });

    // Retry on 429 with exponential backoff
    if (res.status === 429 && attempt < retries - 1) {
      const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }

    return res;
  }

  // Should not reach here, but TypeScript needs it
  throw AppError.internal('Amazon Business API: max retries exceeded');
}

// ── API Functions ──────────────────────────────────────────────────────

/** Search for products on Amazon Business */
export async function searchProducts(
  config: AmazonBusinessConfig,
  query: string,
  limit = 20
): Promise<AmazonProduct[]> {
  const params = new URLSearchParams({ keywords: query, pageSize: String(limit) });
  const res = await amazonBusinessFetch(config, `/products/search?${params}`);

  if (!res.ok) {
    const body = await res.text().catch(() => 'unknown error');
    throw AppError.internal(`Amazon product search failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return (data.products || data.items || []).map((p: any) => ({
    asin: p.asin || p.ASIN,
    title: p.title || p.itemName || '',
    price: p.price ? { amount: p.price.amount, currency: p.price.currency || 'USD' } : undefined,
    availability: p.availability || p.availabilityType,
    imageUrl: p.imageUrl || p.mainImageUrl,
  }));
}

/** Get a single product by ASIN */
export async function getProduct(
  config: AmazonBusinessConfig,
  asin: string
): Promise<AmazonProduct> {
  const res = await amazonBusinessFetch(config, `/products/${asin}`);

  if (!res.ok) {
    throw AppError.internal(`Amazon product lookup failed for ${asin}: ${res.status}`);
  }

  const p = await res.json();
  return {
    asin: p.asin || p.ASIN || asin,
    title: p.title || p.itemName || '',
    price: p.price ? { amount: p.price.amount, currency: p.price.currency || 'USD' } : undefined,
    availability: p.availability || p.availabilityType,
    imageUrl: p.imageUrl || p.mainImageUrl,
  };
}

/** Create an empty cart */
export async function createCart(
  config: AmazonBusinessConfig
): Promise<string> {
  const res = await amazonBusinessFetch(config, '/purchasing/carts', {
    method: 'POST',
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => 'unknown error');
    throw AppError.internal(`Amazon cart creation failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return data.cartId || data.id;
}

/** Add items to cart */
export async function addCartItems(
  config: AmazonBusinessConfig,
  cartId: string,
  items: AmazonCartItem[]
): Promise<void> {
  const res = await amazonBusinessFetch(config, `/purchasing/carts/${cartId}/items`, {
    method: 'POST',
    body: JSON.stringify({ items: items.map((i) => ({ asin: i.asin, quantity: i.quantity })) }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => 'unknown error');
    throw AppError.internal(`Amazon add cart items failed (${res.status}): ${body}`);
  }
}

/** Get cost estimate for a cart + shipping address */
export async function getCostEstimate(
  config: AmazonBusinessConfig,
  cartId: string,
  address: AmazonShippingAddress
): Promise<AmazonCostEstimate> {
  const res = await amazonBusinessFetch(config, `/purchasing/carts/${cartId}/cost-estimate`, {
    method: 'POST',
    body: JSON.stringify({ shippingAddress: address }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => 'unknown error');
    throw AppError.internal(`Amazon cost estimate failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return {
    subtotal: data.subtotal?.amount ?? 0,
    shipping: data.shipping?.amount ?? 0,
    tax: data.tax?.amount ?? 0,
    total: data.total?.amount ?? 0,
    currency: data.total?.currency || 'USD',
    items: (data.items || []).map((i: any) => ({
      asin: i.asin,
      unit_price: i.unitPrice?.amount ?? 0,
      quantity: i.quantity ?? 0,
      line_total: i.lineTotal?.amount ?? 0,
    })),
  };
}

/** Place an order from a cart */
export async function placeOrder(
  config: AmazonBusinessConfig,
  cartId: string,
  address: AmazonShippingAddress,
  externalId: string
): Promise<{ orderId: string; status: string }> {
  const res = await amazonBusinessFetch(config, `/purchasing/carts/${cartId}/place-order`, {
    method: 'POST',
    body: JSON.stringify({
      shippingAddress: address,
      externalReferenceId: externalId,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => 'unknown error');
    throw AppError.internal(`Amazon order placement failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return {
    orderId: data.orderId || data.amazonOrderId || data.id,
    status: data.status || 'submitted',
  };
}

/** Check order status */
export async function getOrderStatus(
  config: AmazonBusinessConfig,
  orderId: string
): Promise<{ status: string; trackingInfo?: AmazonOrder['tracking_info'] }> {
  const res = await amazonBusinessFetch(config, `/purchasing/orders/${orderId}`);

  if (!res.ok) {
    throw AppError.internal(`Amazon order status check failed for ${orderId}: ${res.status}`);
  }

  const data = await res.json();
  return {
    status: data.status || 'unknown',
    trackingInfo: data.tracking ? {
      carrier: data.tracking.carrier,
      tracking_number: data.tracking.trackingNumber,
      estimated_delivery: data.tracking.estimatedDelivery,
    } : undefined,
  };
}

/** Validate connection by refreshing token and performing a test search */
export async function validateConnection(
  config: AmazonBusinessConfig
): Promise<boolean> {
  try {
    await refreshAccessToken(config);
    // Try a minimal search to verify API access
    const params = new URLSearchParams({ keywords: 'test', pageSize: '1' });
    const accessToken = await refreshAccessToken(config);
    const res = await fetch(`${AMAZON_BUSINESS_BASE}/products/search?${params}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Config Resolver ────────────────────────────────────────────────────

/**
 * Loads the Amazon Business provider record for a tenant and resolves
 * all three secrets (client_id, client_secret, refresh_token) from Vault.
 * Returns a ready-to-use AmazonBusinessConfig.
 */
export async function resolveAmazonBusinessConfig(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
  tenantId: string
): Promise<AmazonBusinessConfig & { providerId: string }> {
  const prov = (adminClient as any).schema('provisioning');

  const { data: provider } = await prov
    .from('providers')
    .select('id, config, is_active')
    .eq('tenant_id', tenantId)
    .eq('provider_type', 'procurement_marketplace')
    .like('provider_key', 'amazon-business%')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  if (!provider) {
    throw AppError.badRequest('Amazon Business is not connected. Configure it in Settings > Integrations.');
  }

  const clientIdRef = provider.config?.client_id_ref;
  const clientSecretRef = provider.config?.client_secret_ref;
  const refreshTokenRef = provider.config?.refresh_token_ref;

  if (!clientIdRef || !clientSecretRef || !refreshTokenRef) {
    throw AppError.internal('Amazon Business provider config is incomplete (missing secret references)');
  }

  // Resolve all three secrets from Vault
  const resolveSecret = async (ref: string): Promise<string> => {
    const { data } = await adminClient
      .from('decrypted_secrets')
      .select('decrypted_secret')
      .eq('name', ref)
      .limit(1)
      .single();
    if (!data?.decrypted_secret) {
      throw AppError.internal(`Amazon Business secret not found in Vault: ${ref}`);
    }
    return data.decrypted_secret;
  };

  const [clientId, clientSecret, refreshToken] = await Promise.all([
    resolveSecret(clientIdRef),
    resolveSecret(clientSecretRef),
    resolveSecret(refreshTokenRef),
  ]);

  return {
    clientId,
    clientSecret,
    refreshToken,
    applicationId: provider.config?.application_id,
    providerId: provider.id,
  };
}
