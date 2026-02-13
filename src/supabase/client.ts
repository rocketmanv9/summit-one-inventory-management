import { createClient as createSupabaseClient, SupabaseClient } from '@supabase/supabase-js';
import {
  clearStoredAccessToken,
  isJwtExpired,
  loadAccessToken,
  redirectToCoreLogin,
  refreshAccessToken,
} from '@/lib/auth-token';

// Singleton instance
let client: SupabaseClient | null = null;
let browserAuthedClient: SupabaseClient | null = null;

// Client-side Supabase client factory
// Returns singleton instance to avoid multiple GoTrueClient warnings
// Note: Use API routes for inventory schema access (permission denied on direct queries)
export function createClient() {
  if (!client) {
    client = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return client;
}

// Helper to create authenticated client with Bearer token
export function createAuthenticatedClient(accessToken: string) {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      auth: {
        persistSession: false,
      },
    }
  );
}

async function getValidAccessToken(): Promise<string | null> {
  const token = await loadAccessToken();
  if (!token) return null;

  if (isJwtExpired(token)) {
    const refreshedToken = await refreshAccessToken();
    if (!refreshedToken) {
      clearStoredAccessToken();
      redirectToCoreLogin();
      return null;
    }
    return refreshedToken;
  }

  return token;
}

// Client-side helper that injects stored stateless token when available
export function createBrowserAuthedClient() {
  if (typeof window === 'undefined') {
    return createClient();
  }

  if (browserAuthedClient) {
    return browserAuthedClient;
  }

  void loadAccessToken();

  browserAuthedClient = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        fetch: async (input, init = {}) => {
          const token = await getValidAccessToken();
          const headers = new Headers(init.headers);

          if (token) {
            headers.set('Authorization', `Bearer ${token}`);
          }

          const response = await fetch(input, { ...init, headers });
          if (response.status !== 401) {
            return response;
          }

          const refreshedToken = await refreshAccessToken();
          if (!refreshedToken) {
            clearStoredAccessToken();
            redirectToCoreLogin();
            return response;
          }

          const retryHeaders = new Headers(init.headers);
          retryHeaders.set('Authorization', `Bearer ${refreshedToken}`);
          return fetch(input, { ...init, headers: retryHeaders });
        },
      },
      auth: {
        persistSession: false,
      },
    }
  );

  return browserAuthedClient;
}

