'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useSession } from '@/hooks/useSession';
import { useViewAs } from '@/lib/view-as';
import { findTabGroup, isTabActive, type NavTab } from '@/lib/nav';

// Top-of-page tab strip for the current section's sibling pages. Renders
// nothing when the route isn't part of a multi-page section, so it's safe to
// mount globally (see AppShell). This is the ONE tab bar used app-wide.
export function PageTabs() {
  const pathname = usePathname();
  const { session } = useSession();
  const { can } = useViewAs();
  const isDeveloper = session?.isDeveloper === true;
  const isAdminOrDev = isDeveloper || session?.role === 'admin';

  const group = findTabGroup(pathname);
  if (!group) return null;

  const visible = group.filter((tab) => {
    if (tab.hidden) return false;
    if (tab.requiresDeveloper && !isDeveloper) return false;
    if (tab.requiresAdminOrDev && !isAdminOrDev) return false;
    if (!can(tab.capability)) return false;
    return true;
  });
  if (visible.length <= 1) return null;

  const tabClass = (active: boolean) =>
    cn(
      'flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
      active
        ? 'border-primary text-primary'
        : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
    );

  const renderTab = (tab: NavTab) => {
    const Icon = tab.icon;

    if (tab.external) {
      return (
        <a
          key={tab.href}
          href={tab.href}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(tabClass(false), 'ml-auto')}
        >
          <Icon className="h-4 w-4 flex-shrink-0" />
          {tab.title} ↗
        </a>
      );
    }

    const active = isTabActive(pathname, tab.href);
    return (
      <Link
        key={tab.href}
        href={tab.href}
        aria-current={active ? 'page' : undefined}
        className={tabClass(active)}
      >
        <Icon className="h-4 w-4 flex-shrink-0" />
        {tab.title}
      </Link>
    );
  };

  return (
    <div className="mb-6 border-b border-border">
      <nav className="-mb-px flex flex-wrap gap-1" aria-label="Section tabs">
        {visible.map(renderTab)}
      </nav>
    </div>
  );
}
