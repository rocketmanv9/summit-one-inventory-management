import {
  Package,
  Tags,
  Users,
  PackageSearch,
  TrendingUp,
  ClipboardCheck,
  CalendarDays,
  History,
  ShieldCheck,
  Boxes,
  LineChart,
} from 'lucide-react';

export interface PageTab {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

// Groups of sibling pages that share one sidebar link and switch via tabs.
// The first tab in each group is the "parent" the sidebar points at.
export const TAB_GROUPS: PageTab[][] = [
  [
    { title: 'Stock Balances', href: '/inventory/stock', icon: Boxes },
    { title: 'Usage Trends', href: '/inventory/usage-trends', icon: LineChart },
  ],
  [
    { title: 'Items', href: '/inventory/items', icon: Package },
    { title: 'Categories', href: '/inventory/categories', icon: Tags },
  ],
  [
    { title: 'Vendors', href: '/inventory/vendors', icon: Users },
    { title: 'Vendor Items', href: '/inventory/vendor-items', icon: PackageSearch },
    { title: 'Vendor Performance', href: '/inventory/vendor-performance', icon: TrendingUp },
  ],
  [
    { title: 'Cycle Counts', href: '/inventory/cycle-counts', icon: ClipboardCheck },
    { title: 'Count Schedule', href: '/inventory/count-schedule', icon: CalendarDays },
  ],
  [
    { title: 'Ledger', href: '/inventory/audit', icon: History },
    { title: 'Data Integrity', href: '/inventory/integrity', icon: ShieldCheck },
  ],
];

// A path belongs to a tab if it equals the href or is a child route of it
// (e.g. /inventory/items/123 still highlights the Items tab).
function pathMatchesTab(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/');
}

// Find the tab group the current path lives in, or null if none.
export function findTabGroup(pathname: string): PageTab[] | null {
  for (const group of TAB_GROUPS) {
    if (group.some((t) => pathMatchesTab(pathname, t.href))) return group;
  }
  return null;
}

export function isTabActive(pathname: string, href: string): boolean {
  return pathMatchesTab(pathname, href);
}
