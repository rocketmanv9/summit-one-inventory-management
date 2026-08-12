/**
 * Printful REST API Client
 *
 * Wraps the Printful v2-ish REST API for order management.
 * Requires PRINTFUL_API_TOKEN and PRINTFUL_STORE_ID env vars.
 *
 * Docs: https://developers.printful.com/docs/
 */

import { requireOk } from '@rocketmanv9/chassis/observability';
import { AppError } from '@rocketmanv9/chassis/errors';

// ── Types ────────────────────────────────────────────────────────────────────

export interface PrintfulProduct {
  id: number;
  title: string;
  variants: number;
  image: string;
}

export interface PrintfulVariant {
  id: number;
  product_id: number;
  name: string;
  size: string;
  color: string;
  price: string;
  in_stock: boolean;
}

export interface PrintfulRecipient {
  name: string;
  company?: string;
  address1: string;
  address2?: string;
  city: string;
  state_code: string;
  country_code: string;
  zip: string;
  phone?: string;
  email?: string;
}

export interface PrintfulOrderItem {
  variant_id: number;
  quantity: number;
  name?: string;
  files: Array<{
    type: string;   // 'front' | 'back' | 'label_outside' etc.
    url: string;
  }>;
}

export interface PrintfulOrderInput {
  external_id?: string;
  recipient: PrintfulRecipient;
  items: PrintfulOrderItem[];
  retail_costs?: {
    currency?: string;
    subtotal?: string;
    shipping?: string;
    tax?: string;
    total?: string;
  };
}

export interface PrintfulOrder {
  id: number;
  external_id: string;
  status: string;
  created: number;
  updated: number;
  recipient: PrintfulRecipient;
  items: Array<{
    id: number;
    variant_id: number;
    quantity: number;
    name: string;
    price: string;
  }>;
  retail_costs: {
    currency: string;
    subtotal: string;
    shipping: string;
    tax: string;
    total: string;
  };
  shipments?: Array<{
    id: number;
    carrier: string;
    service: string;
    tracking_number: string;
    tracking_url: string;
    ship_date: string;
  }>;
}

export interface PrintfulCostEstimate {
  costs: {
    currency: string;
    subtotal: string;
    shipping: string;
    tax: string;
    total: string;
  };
}

// ── Client ───────────────────────────────────────────────────────────────────

const BASE_URL = 'https://api.printful.com';

function getHeaders(): Record<string, string> {
  const token = process.env.PRINTFUL_API_TOKEN;
  const storeId = process.env.PRINTFUL_STORE_ID;

  if (!token) throw AppError.internal('PRINTFUL_API_TOKEN is not configured');

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  if (storeId) {
    headers['X-PF-Store-Id'] = storeId;
  }

  return headers;
}

async function printfulFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const headers = getHeaders();

  const response = await fetch(url, {
    ...options,
    headers: { ...headers, ...(options.headers as Record<string, string> || {}) },
  });

  await requireOk(response, `Printful ${options.method || 'GET'} ${path}`);

  const json = await response.json();
  return json.result as T;
}

// ── Catalog ──────────────────────────────────────────────────────────────────

export async function getProducts(): Promise<PrintfulProduct[]> {
  return printfulFetch<PrintfulProduct[]>('/store/products');
}

export async function getProductVariants(productId: number): Promise<PrintfulVariant[]> {
  const result = await printfulFetch<{ sync_variants: PrintfulVariant[] }>(
    `/store/products/${productId}`
  );
  return result.sync_variants;
}

// ── Orders ───────────────────────────────────────────────────────────────────

export async function createDraftOrder(order: PrintfulOrderInput): Promise<PrintfulOrder> {
  return printfulFetch<PrintfulOrder>('/orders', {
    method: 'POST',
    body: JSON.stringify(order),
  });
}

export async function confirmOrder(orderId: number): Promise<PrintfulOrder> {
  return printfulFetch<PrintfulOrder>(`/orders/${orderId}/confirm`, {
    method: 'POST',
  });
}

export async function getOrder(orderId: number): Promise<PrintfulOrder> {
  return printfulFetch<PrintfulOrder>(`/orders/${orderId}`);
}

export async function estimateCosts(order: PrintfulOrderInput): Promise<PrintfulCostEstimate> {
  return printfulFetch<PrintfulCostEstimate>('/orders/estimate-costs', {
    method: 'POST',
    body: JSON.stringify(order),
  });
}
