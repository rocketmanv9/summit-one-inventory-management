'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    async function checkSession() {
      try {
        const response = await fetch('/api/auth/session');
        if (response.ok) {
          setAuthenticated(true);
        } else {
          // Session check failed - redirect to core
          const coreUrl = process.env.NEXT_PUBLIC_CORE_URL || 'https://dev.summit-one.app';
          window.location.href = `${coreUrl}/dashboard`;
        }
      } catch (error) {
        console.error('Session check error:', error);
        const coreUrl = process.env.NEXT_PUBLIC_CORE_URL || 'https://dev.summit-one.app';
        window.location.href = `${coreUrl}/dashboard`;
      } finally {
        setLoading(false);
      }
    }

    checkSession();
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!authenticated) {
    return null; // Redirecting
  }

  return <AppShell>{children}</AppShell>;
}
