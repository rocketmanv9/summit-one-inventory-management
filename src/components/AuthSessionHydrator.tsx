'use client';

import { useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

/**
 * AuthSessionHydrator
 *
 * Client-side component that:
 * 1. Detects access_token in URL (from auth callback)
 * 2. Stores token for stateless header injection
 * 3. Redirects to /dashboard to clear URL parameters
 *
 * Why this is needed:
 * - The backend mints a JWT for Supabase RLS compatibility
 * - The JWT is passed via URL (standard OAuth pattern)
 * - This component captures it for header injection
 * - Supabase requests include the JWT via Authorization header
 * - Supabase RLS policies can verify tenant_id from JWT claims
 *
 * Mounted in: src/app/layout.tsx
 */
export function AuthSessionHydrator() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const accessToken = searchParams.get('access_token');

    if (!accessToken) {
      // No tokens in URL, nothing to do
      return;
    }

      try {
        localStorage.setItem('custom_access_token', accessToken);
        console.log('[AuthSessionHydrator] Stored access token for header injection');
      } catch (err) {
        console.error('[AuthSessionHydrator] Error storing token:', err);
      }

      router.replace('/dashboard');
  }, [searchParams, router]);

  // This component is invisible, just does setup
  return null;
}
