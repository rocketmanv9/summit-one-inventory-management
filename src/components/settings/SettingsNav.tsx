'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const SETTINGS_TABS = [
  { label: 'General', href: '/settings' },
  { label: 'People & Limits', href: '/settings/people' },
  { label: 'Branding', href: '/settings/branding' },
  { label: 'Device Management', href: '/settings/device-management' },
  { label: 'Integrations', href: '/settings/integrations' },
] as const;

export function SettingsNav() {
  const pathname = usePathname();

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
    </div>
  );
}
