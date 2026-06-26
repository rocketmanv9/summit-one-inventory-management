'use client';

import { Lock } from 'lucide-react';
import { useViewAs } from '@/lib/view-as';

/**
 * Renders children only when the current view (real user, or previewed position)
 * has `capability`. Use it for action buttons and page sections.
 *
 * IMPORTANT: must be rendered INSIDE <AppShell> (which mounts the ViewAsProvider).
 * Pages that render their own <AppShell> cannot read the provider at their top
 * level — wrap the gated UI in this component instead.
 *
 * mode="hide" (default) renders nothing when denied; mode="page" shows a
 * no-access card (use to guard a whole page's content).
 */
export function CapabilityGate({
  capability,
  children,
  fallback = null,
  mode = 'hide',
}: {
  capability: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
  mode?: 'hide' | 'page';
}) {
  const { can } = useViewAs();
  if (can(capability)) return <>{children}</>;
  if (mode === 'page') {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border bg-white p-12 text-center">
        <Lock className="mb-3 h-8 w-8 text-gray-300" />
        <h2 className="text-base font-semibold text-gray-700">You don&apos;t have access to this</h2>
        <p className="mt-1 max-w-sm text-sm text-gray-500">
          Your position doesn&apos;t include this area. Ask an admin to grant it on Settings → Position Access.
        </p>
      </div>
    );
  }
  return <>{fallback}</>;
}
