/**
 * API Client
 *
 * Authenticated fetch wrappers for API routes.
 */

import {
  getStoredAccessToken,
} from '@/lib/auth-token';

type ApiWriteOptions = {
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: any;
  idempotencyKey?: string;
};

function getAuthHeaders(): Record<string, string> {
  try {
    if (typeof window === 'undefined') return {};
    const token = getStoredAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch (error) {
    console.warn('[API Client] Error getting auth header:', error);
    return {};
  }
}

/**
 * Authenticated fetch wrapper
 */
export async function authenticatedFetch(
  url: string,
  options?: RequestInit
): Promise<Response> {
  const authHeader = getAuthHeaders();

  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeader,
      ...(options?.headers || {}),
    },
  });
}

/**
 * Authenticated write with idempotency
 * Supports both signatures:
 * - apiWrite(url, { method, body })
 * - apiWrite(url, method, body)
 */
export async function apiWrite(
  url: string,
  optionsOrMethod: ApiWriteOptions | ApiWriteOptions['method'],
  body?: any
): Promise<Response> {
  const options: ApiWriteOptions =
    typeof optionsOrMethod === 'string'
      ? { method: optionsOrMethod, body }
      : optionsOrMethod;

  const idempotencyKey = options.idempotencyKey || crypto.randomUUID();
  // Preserve the body's type. A spread like `{ ...options.body }` turns an ARRAY
  // into an object with numeric keys ({"0":…}), which makes array-body routes
  // (e.g. inventory-levels, z.array(...)) fail with "expected array, received object".
  const bodyData = options.body ?? undefined;
  const authHeader = getAuthHeaders();

  return fetch(url, {
    method: options.method,
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
      ...authHeader,
    },
    body: bodyData ? JSON.stringify(bodyData) : undefined,
  });
}

/**
 * Build query string from object
 * @param params - Object of query parameters
 * @returns Query string (without leading ?)
 */
export function buildQueryString(params: Record<string, any>): string {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      searchParams.append(key, String(value));
    }
  }

  return searchParams.toString();
}
