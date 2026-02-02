/**
 * API Client Helper - Adds authorization to fetch requests
 * Automatically includes JWT token from Supabase session
 */

import { createClient } from '@/supabase/client';

/**
 * Get authorization header with JWT token
 */
async function getAuthHeader(): Promise<{ Authorization: string } | {}> {
  try {
    const supabase = createClient();
    const { data: { session }, error } = await supabase.auth.getSession();
    
    if (error || !session?.access_token) {
      console.warn('[API Client] No valid session found');
      return {};
    }
    
    return {
      Authorization: `Bearer ${session.access_token}`
    };
  } catch (error) {
    console.warn('[API Client] Error getting auth header:', error);
    return {};
  }
}

/**
 * Authenticated fetch wrapper
 * Automatically includes JWT token in Authorization header
 */
export async function authenticatedFetch(
  url: string,
  options?: RequestInit
): Promise<Response> {
  const headers = {
    'Content-Type': 'application/json',
    ...options?.headers,
    ...(await getAuthHeader())
  };

  return fetch(url, {
    ...options,
    headers
  });
}

/**
 * Authenticated write with idempotency
 * CRITICAL: Generates stable idempotency key ONCE per call, reused on retries
 * 
 * @param url - API endpoint
 * @param options - Fetch options (method, body, etc.)
 * @param idempotencyKey - Optional override; if not provided, generates one automatically
 * @returns Response
 */
export async function apiWrite(
  url: string,
  options: {
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: any;
    idempotencyKey?: string;
  }
): Promise<Response> {
  // Generate idempotency key ONCE if not provided
  const idempotencyKey = options.idempotencyKey || crypto.randomUUID();
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey,
    ...(await getAuthHeader()) as Record<string, string>
  };

  const bodyData = options.body ? {
    ...options.body,
    last_event_id: options.body.last_event_id || idempotencyKey
  } : undefined;

  return fetch(url, {
    method: options.method,
    headers,
    body: bodyData ? JSON.stringify(bodyData) : undefined
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
