/**
 * Ticket-Based Authentication Hook
 * 
 * Handles the complete SSO flow:
 * 1. Detects ticket in URL (?ticket=...)
 * 2. Exchanges ticket for Supabase session
 * 3. Stores session in Supabase client
 * 4. Cleans up URL
 * 5. Returns user and loading state
 * 
 * This hook automatically authenticates users when they land with a ticket.
 * No API routes needed - uses Supabase client directly.
 * 
 * USAGE IN APP:
 * 
 * function RootLayout() {
 *   const { isLoading, user, error } = useTicketAuth();
 *   
 *   if (isLoading) return <div>Authenticating...</div>;
 *   if (error) return <div>Auth error: {error}</div>;
 *   
 *   return (
 *     <SupabaseProvider>
 *       <Dashboard user={user} />
 *     </SupabaseProvider>
 *   );
 * }
 */

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

export interface TicketAuthUser {
  id: string;
  email?: string;
}

export interface UseTicketAuthReturn {
  isLoading: boolean;
  user: TicketAuthUser | null;
  error: string | null;
  isAuthenticated: boolean;
}

/**
 * Hook: Automatic ticket-based authentication
 * 
 * Features:
 * - Auto-detects ticket in URL query params
 * - Exchanges ticket for Supabase session
 * - Sets Supabase auth state automatically
 * - Cleans up URL (removes ?ticket=...)
 * - Returns loading state, user, and errors
 * 
 * @returns { isLoading, user, error, isAuthenticated }
 */
export function useTicketAuth(): UseTicketAuthReturn {
  const searchParams = useSearchParams();
  const router = useRouter();
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<TicketAuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Exchange ticket for session
   */
  const exchangeTicket = useCallback(
    async (ticket: string) => {
      try {
        console.log('[TicketAuth] Exchanging ticket:', ticket);
        setIsLoading(true);
        setError(null);

        // 1. Call exchange endpoint
        const response = await fetch('/api/auth/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticket })
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to exchange ticket');
        }

        const { access_token, refresh_token, user: exchangedUser } = await response.json();

        console.log('[TicketAuth] Exchange successful:', {
          userId: exchangedUser?.id,
          email: exchangedUser?.email
        });

        // 2. Set Supabase session with the token
        // This is the magic: Now Supabase client is authenticated
        // and RLS policies will work based on the JWT tenant_id
        const { error: sessionError } = await supabase.auth.setSession({
          access_token,
          refresh_token
        });

        if (sessionError) {
          console.error('[TicketAuth] Failed to set session:', sessionError);
          throw sessionError;
        }

        // 3. Update user state
        setUser({
          id: exchangedUser?.id,
          email: exchangedUser?.email
        });

        console.log('[TicketAuth] Session established, user authenticated');

        // 4. Clean up URL (remove ?ticket=...)
        cleanupUrlTicket();

        return { success: true };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error('[TicketAuth] Error exchanging ticket:', errorMessage);
        setError(errorMessage);
        setUser(null);
        return { success: false, error: errorMessage };
      } finally {
        setIsLoading(false);
      }
    },
    [supabase]
  );

  /**
   * Clean up URL: Remove ?ticket=... query param
   */
  const cleanupUrlTicket = useCallback(() => {
    const newSearchParams = new URLSearchParams(searchParams);
    newSearchParams.delete('ticket');

    const newUrl = newSearchParams.toString()
      ? `?${newSearchParams.toString()}`
      : '/';

    window.history.replaceState({}, '', newUrl);
    console.log('[TicketAuth] Cleaned up URL');
  }, [searchParams]);

  /**
   * Effect: Check for ticket on mount and in searchParams
   */
  useEffect(() => {
    const initializeAuth = async () => {
      try {
        // 1. Check if there's a ticket in the URL
        const ticket = searchParams?.get('ticket');

        if (ticket) {
          console.log('[TicketAuth] Found ticket in URL, exchanging...');
          await exchangeTicket(ticket);
          return;
        }

        // 2. No ticket in URL, check if already authenticated
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();

        if (sessionError) {
          console.error('[TicketAuth] Failed to get session:', sessionError);
          setError(sessionError.message);
          setIsLoading(false);
          return;
        }

        if (session?.user) {
          console.log('[TicketAuth] Found existing session, user already authenticated');
          setUser({
            id: session.user.id,
            email: session.user.email
          });
        } else {
          console.log('[TicketAuth] No ticket and no existing session');
          setUser(null);
        }

        setIsLoading(false);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error('[TicketAuth] Initialization error:', errorMessage);
        setError(errorMessage);
        setIsLoading(false);
      }
    };

    initializeAuth();
  }, [searchParams, exchangeTicket, supabase.auth]);

  return {
    isLoading,
    user,
    error,
    isAuthenticated: !!user && !error
  };
}

/**
 * Hook: Check if user is authenticated
 * 
 * Simpler version if you just need a boolean
 * 
 * @returns true if user is authenticated
 */
export function useIsAuthenticated(): boolean {
  const { isAuthenticated } = useTicketAuth();
  return isAuthenticated;
}

/**
 * Hook: Get current user
 * 
 * Simpler version if you just need the user
 * 
 * @returns User object or null
 */
export function useTicketAuthUser(): TicketAuthUser | null {
  const { user } = useTicketAuth();
  return user;
}

/**
 * Utility: Generate ticket URL for sharing
 * 
 * Use this to create links to send to users
 * 
 * @param ticket - The SSO ticket from Core
 * @returns URL with ticket query param
 */
export function generateTicketUrl(ticket: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
  return `${baseUrl}/?ticket=${encodeURIComponent(ticket)}`;
}

/**
 * Utility: Extract ticket from URL
 * 
 * @returns Ticket string or null
 */
export function getTicketFromUrl(): string | null {
  if (typeof window === 'undefined') return null;

  const searchParams = new URLSearchParams(window.location.search);
  return searchParams.get('ticket');
}

/**
 * Utility: Check if URL has a ticket
 * 
 * @returns true if URL contains ticket query param
 */
export function hasTicketInUrl(): boolean {
  if (typeof window === 'undefined') return false;

  const searchParams = new URLSearchParams(window.location.search);
  return searchParams.has('ticket');
}
