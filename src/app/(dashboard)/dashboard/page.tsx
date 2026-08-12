'use client';

import { AppShell } from '@/components/layout/AppShell';
import { FixedDashboard } from '@/components/dashboards/FixedDashboard';

/**
 * The one inventory dashboard. It is fixed and opinionated — there is no
 * per-user configuration, no widget picker, and no saved layout. See
 * FixedDashboard for the curated composition.
 */
export default function DashboardPage() {
  return (
    <AppShell>
      <FixedDashboard />
    </AppShell>
  );
}
