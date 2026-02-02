'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { createClient } from '@/supabase/client';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const supabase = createClient();
  
  // Skip auth check for public pages
  const isPublicPage = pathname === '/' || pathname === '/dev-login' || pathname === '/error' || pathname === '/auth-gate';
  
  useEffect(() => {
    if (isPublicPage) {
      setLoading(false);
      setAuthenticated(true);
      return;
    }

    checkSession();
    
    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        setAuthenticated(true);
        setLoading(false);
      } else if (event === 'SIGNED_OUT') {
        setAuthenticated(false);
        redirectToAuth();
      }
    });
    
    return () => {
      subscription.unsubscribe();
    };
  }, [pathname, isPublicPage, searchParams, router]);
  
  async function checkSession() {
    try {
      // Check for cookie-based session (used in both dev and production)
      const sessionCheck = await fetch('/api/auth/session-check');
      if (sessionCheck.ok) {
        const data = await sessionCheck.json();
        if (data.authenticated) {
          console.log('[AuthGate] Session found:', data.session);
          setAuthenticated(true);
          setLoading(false);
          return;
        }
      }

      // No session found, redirect to auth
      console.log('[AuthGate] No active session, redirecting to auth');
      redirectToAuth();
    } catch (error) {
      console.error('[AuthGate] Session check error:', error);
      redirectToAuth();
    } finally {
      setLoading(false);
    }
  }
  
  function redirectToAuth() {
    // Redirect to root login page (which has SSO and dev login options)
    router.push('/');
  }
  
  if (isPublicPage) {
    return <>{children}</>;
  }
  
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Authenticating...</p>
        </div>
      </div>
    );
  }
  
  if (!authenticated) {
    return null; // Redirecting
  }
  
  return <>{children}</>;
}
