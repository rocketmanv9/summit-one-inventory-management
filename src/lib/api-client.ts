/**
 * API Client Shim
 *
 * Keeps the same apiWrite signature used across the app,
 * but routes inventory/supply-chain calls directly to Supabase.
 */

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import {
  clearStoredAccessToken,
  getStoredAccessToken,
  redirectToCoreLogin,
  refreshAccessToken,
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

function createAuthedClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: getAuthHeaders(),
      },
    }
  );
}

function isLikelyId(value: string): boolean {
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ||
    /^\d+$/.test(value)
  );
}

function slugToSnake(value: string): string {
  return value.replace(/-/g, '_');
}

function singularize(value: string): string {
  if (value.endsWith('ies')) return `${value.slice(0, -3)}y`;
  if (value.endsWith('s')) return value.slice(0, -1);
  return value;
}

function parseApiUrl(url: string) {
  const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
  const parsed = new URL(url, base);
  const rawPath = parsed.pathname.startsWith('/api/')
    ? parsed.pathname.slice(5)
    : parsed.pathname.replace(/^\/+/, '');

  const segments = rawPath.split('/').filter(Boolean);
  const [namespace, resource, maybeIdOrAction, ...rest] = segments;
  let id: string | null = null;
  let actionSegments: string[] = [];

  if (maybeIdOrAction && isLikelyId(maybeIdOrAction)) {
    id = maybeIdOrAction;
    actionSegments = rest;
  } else if (maybeIdOrAction) {
    actionSegments = [maybeIdOrAction, ...rest];
  }

  return {
    namespace,
    resource,
    id,
    actionSegments,
    searchParams: parsed.searchParams
  };
}

function isShimRoute(url: string): boolean {
  const { namespace } = parseApiUrl(url);
  return namespace === 'inventory' || namespace === 'supply-chain';
}

function getSchema(namespace?: string) {
  if (namespace === 'inventory') return 'inventory';
  if (namespace === 'supply-chain') return 'supply_chain';
  return undefined;
}

function getTableName(resource?: string) {
  if (!resource) return undefined;

  const map: Record<string, string> = {
    items: 'catalog_items',
    categories: 'item_categories',
    movements: 'stock_movements',
    'vendor-items': 'vendor_items',
    'location-types': 'location_types',
    'assignment-types': 'assignment_types',
    'cycle-counts': 'cycle_counts',
    purchasing: 'purchase_orders',
  };

  return map[resource] || slugToSnake(resource);
}

async function runRpc(
  supabase: any,
  resource: string,
  actionSegments: string[],
  payload: Record<string, any>
) {
  const resourceSnake = slugToSnake(resource);
  const resourceSingular = singularize(resourceSnake);
  const actionSnake = actionSegments.map(slugToSnake).join('_');

  const rpcCandidates = [
    `rpc_${resourceSingular}_${actionSnake}`,
    `${resourceSingular}_${actionSnake}`,
    `rpc_${resourceSnake}_${actionSnake}`,
    `${resourceSnake}_${actionSnake}`,
    `rpc_${actionSnake}`,
    actionSnake,
  ];

  for (const rpcName of rpcCandidates) {
    const { data, error } = await supabase.rpc(rpcName, payload);
    if (!error) {
      return { data, error: null };
    }

    const message = error.message || '';
    const code = (error as any).code;
    if (code === 'PGRST202' || message.includes('does not exist')) {
      continue;
    }

    return { data: null, error };
  }

  return {
    data: null,
    error: new Error(`RPC not found for ${resource}:${actionSegments.join('/')}`),
  };
}

function isAuthError(error: any): boolean {
  if (!error) return false;

  const status = typeof error.status === 'number' ? error.status : null;
  const code = typeof error.code === 'string' ? error.code : '';
  const message = String(error.message || '').toLowerCase();

  return (
    status === 401 ||
    status === 403 ||
    code === 'PGRST301' ||
    message.includes('jwt') ||
    message.includes('unauthorized') ||
    message.includes('invalid token') ||
    message.includes('not authenticated')
  );
}

async function shimRequest(
  url: string,
  method: string,
  body?: any,
  allowAuthRetry: boolean = true
): Promise<Response> {
  const { namespace, resource, id, actionSegments, searchParams } = parseApiUrl(url);
  const supabase = createAuthedClient();
  let schema = getSchema(namespace);
  const table = getTableName(resource);

  if (namespace === 'inventory' && resource === 'vendors') {
    schema = undefined;
  }

  if (!resource || !table) {
    return new Response(JSON.stringify({ error: 'Invalid resource' }), { status: 400 });
  }

  const scoped = schema ? supabase.schema(schema) : supabase;

  const basePayload: Record<string, any> = {
    ...(body || {}),
  };

  if (id) {
    basePayload.id = basePayload.id || id;
  }

  if (actionSegments.length > 0) {
    if (id) {
      const singular = singularize(slugToSnake(resource));
      basePayload[`${singular}_id`] = basePayload[`${singular}_id`] || id;
      basePayload[`p_${singular}_id`] = basePayload[`p_${singular}_id`] || id;
    }
    const result = await runRpc(scoped, resource, actionSegments, basePayload);
    if (result.error) {
      if (allowAuthRetry && isAuthError(result.error)) {
        const refreshedToken = await refreshAccessToken();
        if (refreshedToken) {
          return shimRequest(url, method, body, false);
        }

        clearStoredAccessToken();
        redirectToCoreLogin();
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
      }

      return new Response(
        JSON.stringify({ error: (result.error as Error).message || 'RPC failed' }),
        { status: 400 }
      );
    }

    return new Response(JSON.stringify({ data: result.data }), { status: 200 });
  }

  switch (method.toUpperCase()) {
    case 'GET': {
      let query = scoped.from(table).select('*');
      if (id) {
        query = query.eq('id', id);
      }
      for (const [key, value] of searchParams.entries()) {
        if (value !== undefined && value !== null && value !== '') {
          query = query.eq(key, value);
        }
      }
      const { data, error } = await query;
      if (error) {
        if (allowAuthRetry && isAuthError(error)) {
          const refreshedToken = await refreshAccessToken();
          if (refreshedToken) {
            return shimRequest(url, method, body, false);
          }

          clearStoredAccessToken();
          redirectToCoreLogin();
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
        }

        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
      }
      return new Response(JSON.stringify({ data }), { status: 200 });
    }
    case 'POST': {
      // Ensure last_event_id for idempotency on insert
      if (!basePayload.last_event_id) {
        basePayload.last_event_id = crypto.randomUUID();
      }
      const { data, error } = await scoped.from(table).insert(basePayload).select();
      if (error) {
        if (allowAuthRetry && isAuthError(error)) {
          const refreshedToken = await refreshAccessToken();
          if (refreshedToken) {
            return shimRequest(url, method, body, false);
          }

          clearStoredAccessToken();
          redirectToCoreLogin();
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
        }

        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
      }
      return new Response(JSON.stringify({ data }), { status: 200 });
    }
    case 'PUT':
    case 'PATCH': {
      const updateId = id || basePayload.id;
      if (!updateId) {
        return new Response(JSON.stringify({ error: 'Missing id for update' }), { status: 400 });
      }
      let updateQuery = scoped
        .from(table)
        .update(basePayload)
        .eq('id', updateId);
      // OCC guard: if body includes last_event_id, use it for optimistic locking
      if (basePayload.last_event_id) {
        updateQuery = updateQuery.eq('last_event_id', basePayload.last_event_id);
      }
      const { data, error } = await updateQuery.select();
      if (error) {
        if (allowAuthRetry && isAuthError(error)) {
          const refreshedToken = await refreshAccessToken();
          if (refreshedToken) {
            return shimRequest(url, method, body, false);
          }

          clearStoredAccessToken();
          redirectToCoreLogin();
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
        }

        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
      }
      return new Response(JSON.stringify({ data }), { status: 200 });
    }
    case 'DELETE': {
      const deleteId = id || basePayload.id;
      if (!deleteId) {
        return new Response(JSON.stringify({ error: 'Missing id for delete' }), { status: 400 });
      }
      let deleteQuery = scoped
        .from(table)
        .delete()
        .eq('id', deleteId);
      // OCC guard: if body includes last_event_id, use it for optimistic locking
      if (basePayload.last_event_id) {
        deleteQuery = deleteQuery.eq('last_event_id', basePayload.last_event_id);
      }
      const { data, error } = await deleteQuery.select();
      if (error) {
        if (allowAuthRetry && isAuthError(error)) {
          const refreshedToken = await refreshAccessToken();
          if (refreshedToken) {
            return shimRequest(url, method, body, false);
          }

          clearStoredAccessToken();
          redirectToCoreLogin();
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
        }

        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
      }
      return new Response(JSON.stringify({ data }), { status: 200 });
    }
    default:
      return new Response(JSON.stringify({ error: `Unsupported method ${method}` }), { status: 405 });
  }
}

/**
 * Authenticated fetch wrapper
 * Falls back to fetch for non-shim routes.
 */
export async function authenticatedFetch(
  url: string,
  options?: RequestInit
): Promise<Response> {
  if (isShimRoute(url)) {
    let body: any = options?.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        // Leave body as-is when it is not JSON.
      }
    }
    return shimRequest(url, options?.method || 'GET', body);
  }

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
  const bodyData = options.body ? { ...options.body } : undefined;

  if (isShimRoute(url)) {
    return shimRequest(url, options.method, bodyData);
  }

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
