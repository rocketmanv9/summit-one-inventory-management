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
 * Helper to build query string
 */
export function buildQueryString(
  params: Record<string, string | number | boolean | undefined | null>
): string {
  const searchParams = new URLSearchParams();
  
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      searchParams.append(key, String(value));
    }
  }
  
  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}
