'use client';

import { Suspense, useEffect } from 'react';
import { useRouter } from 'next/navigation';

function HomeContent() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    const checkAuthAndRedirect = async () => {
      const params = new URLSearchParams(window.location.search);
      const ticket = params.get('ticket');
      const targetOrg = params.get('target_org');
      const targetService = params.get('target_service');

      if (ticket) {
        // Has ticket, redirect to auth callback for server-side exchange
        const redirectParams = new URLSearchParams();
        redirectParams.set('ticket', ticket);
        if (targetOrg) {
          redirectParams.set('target_org', targetOrg);
        }
        if (targetService) {
          redirectParams.set('target_service', targetService);
        }
        window.location.href = `/auth/callback?${redirectParams.toString()}`;
        return;
      }

    // No ticket, check if user is authenticated via access token endpoint
      const response = await fetch('/api/auth/token', {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      }).catch(() => null);

      if (cancelled) return;

      if (!response?.ok) {
        // Not authenticated and no ticket, redirect to Core login
        const coreUrl = process.env.NEXT_PUBLIC_CORE_APP_URL || 'https://dev.summit-one.app';
        window.location.href = `${coreUrl}/login`;
        return;
      }

      // Already authenticated, go to dashboard
      router.push('/dashboard');
    };

    void checkAuthAndRedirect();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950">
      <div className="rounded-xl border border-slate-800 bg-slate-900 px-8 py-6 text-center">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-sm font-medium text-slate-400 uppercase">Inventory Management</p>
        <p className="mt-2 text-lg font-semibold text-white">Redirecting...</p>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="rounded-xl border border-slate-800 bg-slate-900 px-8 py-6 text-center">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-sm font-medium text-slate-400 uppercase">Inventory Management</p>
          <p className="mt-2 text-lg font-semibold text-white">Loading...</p>
        </div>
      </div>
    }>
      <HomeContent />
    </Suspense>
  );
}
