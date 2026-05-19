/**
 * Printify API Client
 *
 * Standalone HTTP client for Printify integration.
 * Handles order placement, product listing, and config resolution from Vault.
 */

import { AppError } from '@rocketmanv9/chassis/errors';

// ── Types ──────────────────────────────────────────────────────────────

export interface PrintifyConfig {
  apiToken: string;
  shopId: string;
}

export interface PrintifyLineItem {
  product_id: string;
  variant_id: number;
  quantity: number;
}

export interface PrintifyAddress {
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  country: string;
  region: string;
  address1: string;
  address2?: string;
  city: string;
  zip: string;
}

export interface CreatePrintifyOrderInput {
  external_id?: string;
  label?: string;
  line_items: PrintifyLineItem[];
  shipping_method: number;
  address_to: PrintifyAddress;
  send_shipping_notification?: boolean;
}

export interface PrintifyOrder {
  id: string;
  status: string;
  created_at: string;
  line_items: PrintifyLineItem[];
  total_price: number;
  total_shipping: number;
  [key: string]: unknown;
}

export interface PrintifyProduct {
  id: string;
  title: string;
  description: string;
  variants: Array<{
    id: number;
    title: string;
    sku: string;
    price: number;
    is_enabled: boolean;
  }>;
  images: Array<{ src: string }>;
  [key: string]: unknown;
}

// ── API Client ─────────────────────────────────────────────────────────

const PRINTIFY_BASE = 'https://api.printify.com/v1';

async function printifyFetch(
  config: PrintifyConfig,
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = `${PRINTIFY_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${config.apiToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  return res;
}

/** POST a new order to Printify */
export async function createPrintifyOrder(
  config: PrintifyConfig,
  order: CreatePrintifyOrderInput
): Promise<PrintifyOrder> {
  const res = await printifyFetch(config, `/shops/${config.shopId}/orders.json`, {
    method: 'POST',
    body: JSON.stringify(order),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => 'unknown error');
    throw AppError.internal(`Printify order creation failed (${res.status}): ${body}`);
  }

  return res.json();
}

/** GET order status from Printify */
export async function getPrintifyOrder(
  config: PrintifyConfig,
  orderId: string
): Promise<PrintifyOrder> {
  const res = await printifyFetch(config, `/shops/${config.shopId}/orders/${orderId}.json`);

  if (!res.ok) {
    throw AppError.internal(`Failed to fetch Printify order ${orderId}: ${res.status}`);
  }

  return res.json();
}

/** POST cancel order on Printify */
export async function cancelPrintifyOrder(
  config: PrintifyConfig,
  orderId: string
): Promise<void> {
  const res = await printifyFetch(
    config,
    `/shops/${config.shopId}/orders/${orderId}/cancel.json`,
    { method: 'POST' }
  );

  if (!res.ok) {
    throw AppError.internal(`Failed to cancel Printify order ${orderId}: ${res.status}`);
  }
}

/** GET products list from Printify shop */
export async function listPrintifyProducts(
  config: PrintifyConfig,
  page = 1,
  limit = 50
): Promise<{ current_page: number; data: PrintifyProduct[]; total: number }> {
  const res = await printifyFetch(
    config,
    `/shops/${config.shopId}/products.json?page=${page}&limit=${limit}`
  );

  if (!res.ok) {
    throw AppError.internal(`Failed to list Printify products: ${res.status}`);
  }

  return res.json();
}

/** GET shop info to validate connection */
export async function validatePrintifyConnection(
  config: PrintifyConfig
): Promise<boolean> {
  try {
    const res = await printifyFetch(config, `/shops/${config.shopId}.json`);
    return res.ok;
  } catch {
    return false;
  }
}

// ── Config Resolver ────────────────────────────────────────────────────

/**
 * Loads the Printify provider record for a tenant and resolves
 * the API token from Vault. Returns a ready-to-use PrintifyConfig.
 */
export async function resolvePrintifyConfig(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
  tenantId: string
): Promise<PrintifyConfig & { providerId: string }> {
  const prov = (adminClient as any).schema('provisioning');

  const { data: provider } = await prov
    .from('providers')
    .select('id, config, is_active')
    .eq('tenant_id', tenantId)
    .eq('provider_type', 'print_on_demand')
    .like('provider_key', 'printify%')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  if (!provider) {
    throw AppError.badRequest('Printify is not connected. Configure it in Settings > Integrations.');
  }

  const shopId = provider.config?.shop_id;
  const tokenRef = provider.config?.api_token_ref;

  if (!shopId || !tokenRef) {
    throw AppError.internal('Printify provider config is incomplete (missing shop_id or api_token_ref)');
  }

  // Resolve token from Vault
  const { data: secretRow } = await adminClient
    .from('decrypted_secrets')
    .select('decrypted_secret')
    .eq('name', tokenRef)
    .limit(1)
    .single();

  if (!secretRow?.decrypted_secret) {
    throw AppError.internal('Printify API token not found in Vault');
  }

  return {
    apiToken: secretRow.decrypted_secret,
    shopId,
    providerId: provider.id,
  };
}
