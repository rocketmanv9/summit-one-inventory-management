/**
 * Printify API Client
 *
 * Low-level wrapper around the Printify REST API.
 * Handles authentication, request formatting, and response parsing.
 */

import { requireOk } from '@rocketmanv9/chassis/observability';

const PRINTIFY_API_BASE = 'https://api.printify.com/v1';

export interface PrintifyConfig {
  api_token_ref: string;
  shop_id: string;
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

export interface PrintifyOrderRequest {
  external_id: string;
  label: string;
  line_items: PrintifyLineItem[];
  shipping_method: number;
  address_to: PrintifyAddress;
  send_shipping_notification?: boolean;
}

export interface PrintifyOrder {
  id: string;
  external_id: string;
  status: string;
  line_items: Array<{
    product_id: string;
    variant_id: number;
    quantity: number;
    status: string;
  }>;
  shipments: Array<{
    carrier: string;
    number: string;
    url: string;
    delivered_at: string | null;
  }>;
  created_at: string;
}

async function printifyFetch(
  path: string,
  apiToken: string,
  options?: RequestInit,
): Promise<Response> {
  const res = await fetch(`${PRINTIFY_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  return res;
}

/**
 * Create an order on Printify.
 */
export async function createPrintifyOrder(
  config: PrintifyConfig,
  order: PrintifyOrderRequest,
): Promise<PrintifyOrder> {
  const res = await printifyFetch(
    `/shops/${config.shop_id}/orders.json`,
    config.api_token_ref,
    {
      method: 'POST',
      body: JSON.stringify(order),
    },
  );
  await requireOk(res, 'Printify create order');
  return res.json();
}

/**
 * Get an order from Printify.
 */
export async function getPrintifyOrder(
  config: PrintifyConfig,
  orderId: string,
): Promise<PrintifyOrder> {
  const res = await printifyFetch(
    `/shops/${config.shop_id}/orders/${orderId}.json`,
    config.api_token_ref,
  );
  await requireOk(res, 'Printify get order');
  return res.json();
}

/**
 * Cancel an order on Printify.
 */
export async function cancelPrintifyOrder(
  config: PrintifyConfig,
  orderId: string,
): Promise<void> {
  const res = await printifyFetch(
    `/shops/${config.shop_id}/orders/${orderId}/cancel.json`,
    config.api_token_ref,
    { method: 'POST' },
  );
  await requireOk(res, 'Printify cancel order');
}

/**
 * List products from a Printify shop (for mapping validation).
 */
export async function listPrintifyProducts(
  config: PrintifyConfig,
): Promise<Array<{ id: string; title: string; variants: Array<{ id: number; title: string }> }>> {
  const res = await printifyFetch(
    `/shops/${config.shop_id}/products.json`,
    config.api_token_ref,
  );
  await requireOk(res, 'Printify list products');
  const data = await res.json();
  return data.data ?? data;
}

/**
 * Validate Printify credentials by fetching shop info.
 */
export async function validatePrintifyConfig(
  config: PrintifyConfig,
): Promise<{ valid: boolean; shopName?: string; error?: string }> {
  try {
    const res = await printifyFetch(
      `/shops/${config.shop_id}.json`,
      config.api_token_ref,
    );
    if (!res.ok) {
      return { valid: false, error: `API returned ${res.status}: ${res.statusText}` };
    }
    const shop = await res.json();
    return { valid: true, shopName: shop.title };
  } catch (err: any) {
    return { valid: false, error: err.message };
  }
}
