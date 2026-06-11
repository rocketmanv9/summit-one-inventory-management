'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useSession } from '@/hooks/useSession';

const SETTINGS_TABS = [
  { label: 'General', href: '/settings' },
  { label: 'My Spending', href: '/settings/my-spending' },
  { label: 'People & Limits', href: '/settings/people' },
  { label: 'Branding', href: '/settings/branding' },
  { label: 'Device Management', href: '/settings/device-management' },
  { label: 'Integrations', href: '/settings/integrations' },
  { label: 'Test', href: '/settings/test' },
] as const;

// Externally-hosted OpenClaw maintenance assistant (Cloudflare Access–gated).
// Dev-only tool that can edit the codebase, so it opens in a new tab and is
// hidden from non-developer/non-admin users.
const MAINTENANCE_ASSISTANT_URL = 'https://claw.forge-operation.com';

export function SettingsNav() {
  const pathname = usePathname();
  const { session } = useSession();
  const canSeeAssistant = session?.isDeveloper === true || session?.role === 'admin';

  return (
    <div className="mb-6 flex flex-wrap gap-2 border-b pb-3">
      {SETTINGS_TABS.map((tab) => {
        const isActive = pathname === tab.href;

        if (isActive) {
          return (
            <span
              key={tab.href}
              className="px-3 py-1.5 text-sm font-medium rounded-md bg-primary text-primary-foreground"
            >
              {tab.label}
            </span>
          );
        }

        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              'px-3 py-1.5 text-sm font-medium rounded-md',
              'text-gray-600 hover:bg-gray-100',
            )}
          >
            {tab.label}
          </Link>
        );
      })}

      {canSeeAssistant && (
        <a
          href={MAINTENANCE_ASSISTANT_URL}
          target="_blank"
          rel="noopener noreferrer"
          title="Maintenance assistant — opens the OpenClaw bug-fix chat (developers only)"
          className={cn(
            'ml-auto px-3 py-1.5 text-sm font-medium rounded-md',
            'text-gray-400 hover:bg-gray-100 hover:text-gray-600',
          )}
        >
          Assistant ↗
        </a>
      )}
    </div>
  );
}
