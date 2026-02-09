import { createClient as createSupabaseClient, SupabaseClient } from '@supabase/supabase-js';
import { clearStoredAccessToken, isJwtExpired, redirectToCoreLogin } from '@/lib/auth-token';

// Singleton instance
let client: SupabaseClient | null = null;

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

// Client-side helper that injects stored stateless token when available
export function createBrowserAuthedClient() {
  if (typeof window === 'undefined') {
    return createClient();
  }

  const token = localStorage.getItem('custom_access_token');
  if (!token) {
    return createClient();
  }

  if (isJwtExpired(token)) {
    clearStoredAccessToken();
    redirectToCoreLogin();
    return createClient();
  }

  return createAuthenticatedClient(token);
}

