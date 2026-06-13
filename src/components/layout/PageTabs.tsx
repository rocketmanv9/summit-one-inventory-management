'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { findTabGroup, isTabActive } from '@/lib/page-tabs';

// Top-of-page tab strip for grouped sibling pages. Renders nothing when the
// current route isn't part of a tab group, so it's safe to mount globally.
export function PageTabs() {
  const pathname = usePathname();
  const group = findTabGroup(pathname);
  if (!group) return null;

  return (
    <div className="mb-6 border-b border-border">
      <nav className="-mb-px flex flex-wrap gap-1" aria-label="Section tabs">
        {group.map((tab) => {
          const Icon = tab.icon;
          const active = isTabActive(pathname, tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                active
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
              )}
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              {tab.title}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
