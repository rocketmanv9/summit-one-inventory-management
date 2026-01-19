'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

interface Session {
  userId: string;
  email: string;
  tenantId: string;
  role: string;
  fullName: string;
  expiresAt: number;
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    // Note: The actual SSO callback is now handled by middleware redirecting to /auth/callback
    // This component just checks for existing session
    checkSession();
  }, [searchParams]);
  
  async function checkSession() {
    try {
      const response = await fetch('/api/auth/session');
      if (response.ok) {
        const session = await response.json();
        setSession(session);
      } else {
        redirectToCore();
      }
    } catch (error) {
      console.error('Session check error:', error);
      redirectToCore();
    } finally {
      setLoading(false);
    }
  }
  
  function redirectToCore() {
    // In development, redirect to dev login instead of Core
    if (process.env.NODE_ENV === 'development') {
      router.push('/dev-login');
    } else {
      const coreUrl = process.env.NEXT_PUBLIC_CORE_URL || 'https://dev.summit-one.app';
      window.location.href = `${coreUrl}/dashboard`;
    }
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
  
  if (!session) {
    return null; // Redirecting to core
  }
  
  return <>{children}</>;
}
