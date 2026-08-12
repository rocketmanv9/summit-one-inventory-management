'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';

/**
 * Legacy per-dashboard route. There is now a single fixed dashboard, so any
 * deep-link into a specific dashboard id (old bookmarks, AI dashboard_link
 * results) just lands on the one dashboard. The route is kept so those links
 * don't 404.
 */
export default function DashboardDetailPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/dashboard');
  }, [router]);

  return (
    <AppShell>
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-64 rounded bg-gray-200" />
          <div className="h-96 rounded bg-gray-200" />
        </div>
      </div>
    </AppShell>
  );
}
