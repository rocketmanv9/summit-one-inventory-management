'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTicketAuth } from '@/hooks/use-ticket-auth';

const PUBLIC_PATHS = new Set(['/', '/dev-login', '/error', '/auth-gate']);

export function TicketAuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isLoading, user, error, isAuthenticated } = useTicketAuth();

  const isPublicPage = PUBLIC_PATHS.has(pathname);

  useEffect(() => {
    if (isPublicPage) return;

    if (!isLoading && (!isAuthenticated || error)) {
      router.push('/');
    }
  }, [isPublicPage, isLoading, isAuthenticated, error, router]);

  if (isPublicPage) {
    return <>{children}</>;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Authenticating...</p>
        </div>
      </div>
    );
  }

  if (error || !user) {
    return null;
  }

  return <>{children}</>;
}
