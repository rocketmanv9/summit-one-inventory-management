'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Package,
  MapPin,
  Truck,
  ShoppingCart,
  ClipboardCheck,
  Settings,
  Bug,
  Bot,
  CalendarCheck,
  ArrowLeftRight,
  Users,
  Boxes,
  History,
  Globe,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSession } from '@/hooks/useSession';
import { useTenantBranding } from '@/lib/tenant-branding';

interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
  requiresDeveloper?: boolean;
  // Sibling routes reachable via in-page tabs (see src/lib/page-tabs.ts).
  // Listed so an active tab still highlights this sidebar link.
  tabHrefs?: string[];
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const navigation: NavSection[] = [
  {
    title: 'Overview',
    items: [
      { title: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
      { title: 'Isabelle', href: '/ai', icon: Bot },
      { title: 'Debug', href: '/debug', icon: Bug, requiresDeveloper: true },
    ],
  },
  {
    // What you have: catalog + where it lives.
    title: 'Inventory',
    items: [
      {
        title: 'Stock Balances',
        href: '/inventory/stock',
        icon: Boxes,
        tabHrefs: ['/inventory/usage-trends'],
      },
      {
        title: 'Items',
        href: '/inventory/items',
        icon: Package,
        tabHrefs: ['/inventory/categories'],
      },
      { title: 'Locations', href: '/inventory/locations', icon: MapPin },
      { title: 'Assets', href: '/inventory/assets', icon: Truck },
    ],
  },
  {
    // Buying workflow: orders + the vendors behind them.
    title: 'Purchasing',
    items: [
      { title: 'Purchase Orders', href: '/inventory/purchasing', icon: ShoppingCart },
      {
        title: 'Vendors',
        href: '/inventory/vendors',
        icon: Users,
        tabHrefs: ['/inventory/vendor-items', '/inventory/vendor-performance'],
      },
    ],
  },
  {
    // Day-to-day stock movement and verification.
    title: 'Operations',
    items: [
      { title: 'Transfers', href: '/inventory/transfers', icon: ArrowLeftRight },
      { title: 'Reservations', href: '/inventory/reservations', icon: CalendarCheck },
      {
        title: 'Cycle Counts',
        href: '/inventory/cycle-counts',
        icon: ClipboardCheck,
        tabHrefs: ['/inventory/count-schedule'],
      },
      { title: 'Network', href: '/operations/globe', icon: Globe },
    ],
  },
  {
    title: 'Audit',
    items: [
      {
        title: 'Ledger',
        href: '/inventory/audit',
        icon: History,
        tabHrefs: ['/inventory/integrity'],
      },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { session } = useSession();
  const isDeveloper = session?.isDeveloper === true;
  const { branding } = useTenantBranding();

  const logoUrl = branding.logo_url ?? null;

  // A link is active for its own route, child routes, or any of its tab siblings.
  const isItemActive = (item: NavItem): boolean => {
    const hrefs = [item.href, ...(item.tabHrefs || [])];
    return hrefs.some((h) => pathname === h || pathname.startsWith(h + '/'));
  };

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-64 bg-sidebar border-r border-sidebar-border">
      {/* Logo */}
      <div className="flex h-16 items-center border-b border-sidebar-border px-6">
        <div className="flex items-center gap-2">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={branding.display_name}
              className="h-8 w-8 rounded-lg object-contain"
            />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Package className="h-5 w-5 text-primary-foreground" />
            </div>
          )}
          <div>
            <h1 className="text-sm font-semibold text-sidebar-foreground">
              {branding.display_name}
            </h1>
            <p className="text-xs text-muted-foreground">Inventory</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-4">
        {navigation.map((section) => {
          const visibleItems = section.items.filter(
            (item) => !item.requiresDeveloper || isDeveloper
          );
          if (visibleItems.length === 0) return null;

          return (
            <div key={section.title} className="mb-6">
              <h3 className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {section.title}
              </h3>
              <ul className="space-y-1">
                {visibleItems.map((item) => {
                  const isActive = isItemActive(item);
                  const Icon = item.icon;

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={cn(
                          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                          isActive
                            ? 'bg-primary text-primary-foreground'
                            : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                        )}
                      >
                        <Icon className="h-4 w-4 flex-shrink-0" />
                        <span className="flex-1">{item.title}</span>
                        {item.badge && (
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-xs text-destructive-foreground">
                            {item.badge}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-4">
        <Link
          href="/settings"
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            pathname.startsWith('/settings')
              ? 'bg-primary text-primary-foreground'
              : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
          )}
        >
          <Settings className="h-4 w-4" />
          <span>Settings</span>
        </Link>
      </div>
    </aside>
  );
}
