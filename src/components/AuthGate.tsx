'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const supabase = createClientComponentClient();
  
  // Skip auth check for public pages
  const isPublicPage = pathname === '/dev-login' || pathname === '/error' || pathname === '/auth/callback';
  
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
  }, [pathname, isPublicPage]);
  
  async function checkSession() {
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      
      if (error || !session) {
        console.log('[AuthGate] No active session, redirecting to auth');
        redirectToAuth();
        return;
      }
      
      // Validate that session has tenant_id in metadata
      const tenantId = session.user.user_metadata?.tenant_id;
      if (!tenantId) {
        console.error('[AuthGate] Session missing tenant_id, forcing re-auth');
        await supabase.auth.signOut();
        redirectToAuth();
        return;
      }
      
      console.log('[AuthGate] Valid session found:', { 
        email: session.user.email, 
        tenant_id: tenantId 
      });
      
      setAuthenticated(true);
    } catch (error) {
      console.error('[AuthGate] Session check error:', error);
      redirectToAuth();
    } finally {
      setLoading(false);
    }
  }
  
  function redirectToAuth() {
    // In development, allow dev-login bypass
    if (process.env.NODE_ENV === 'development') {
      router.push('/dev-login');
    } else {
      // Production: redirect to Core SSO
      const coreUrl = process.env.NEXT_PUBLIC_CORE_URL || 'https://dev.summit-one.app';
      const inventoryUrl = window.location.origin;
      window.location.href = `${coreUrl}/sso?service=inventory&return_to=${encodeURIComponent(inventoryUrl)}`;
    }
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
