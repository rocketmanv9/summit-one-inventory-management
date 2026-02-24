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
  Cpu,
  Bug,
  Bot,
  CalendarCheck,
  ArrowLeftRight,
  PackageOpen,
  Users,
  FileText,
  Boxes,
  History,
  Tag,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const navigation: NavSection[] = [
  {
    title: 'Overview',
    items: [
      {
        title: 'Dashboard',
        href: '/dashboard',
        icon: LayoutDashboard,
      },
      {
        title: 'AI Workspace',
        href: '/ai',
        icon: Bot,
      },
      {
        title: 'Debug',
        href: '/debug',
        icon: Bug,
      },
    ],
  },
  {
    title: 'Inventory',
    items: [
      {
        title: 'Stock Balances',
        href: '/inventory/stock',
        icon: Boxes,
      },
      {
        title: 'Items',
        href: '/inventory/items',
        icon: Package,
      },
      {
        title: 'Locations',
        href: '/inventory/locations',
        icon: MapPin,
      },
      {
        title: 'Location Types',
        href: '/inventory/location-types',
        icon: Tag,
      },
      {
        title: 'Assets',
        href: '/inventory/assets',
        icon: Truck,
      },
      {
        title: 'Vendors',
        href: '/inventory/vendors',
        icon: Users,
      },
    ],
  },
  {
    title: 'Operations',
    items: [
      {
        title: 'Reservations',
        href: '/inventory/reservations',
        icon: CalendarCheck,
      },
      {
        title: 'Transfers',
        href: '/inventory/transfers',
        icon: ArrowLeftRight,
      },
      {
        title: 'Purchasing',
        href: '/inventory/purchasing',
        icon: ShoppingCart,
      },
      {
        title: 'Receiving',
        href: '/inventory/receiving',
        icon: PackageOpen,
      },
      {
        title: 'Cycle Counts',
        href: '/inventory/cycle-counts',
        icon: ClipboardCheck,
      },
    ],
  },
  {
    title: 'Audit',
    items: [
      {
        title: 'Ledger',
        href: '/inventory/audit',
        icon: History,
      },
      {
        title: 'Reports',
        href: '/inventory/reports',
        icon: FileText,
      },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-64 bg-sidebar border-r border-sidebar-border">
      {/* Logo */}
      <div className="flex h-16 items-center border-b border-sidebar-border px-6">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <Package className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-sidebar-foreground">
              Summit One
            </h1>
            <p className="text-xs text-muted-foreground">Inventory</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-4">
        {navigation.map((section) => (
          <div key={section.title} className="mb-6">
            <h3 className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {section.title}
            </h3>
            <ul className="space-y-1">
              {section.items.map((item) => {
                const isActive = pathname === item.href;
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
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-4">
        <Link
          href="/settings/device-management"
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors mb-2',
            pathname === '/settings/device-management'
              ? 'bg-primary text-primary-foreground'
              : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
          )}
        >
          <Cpu className="h-4 w-4" />
          <span>Device Management</span>
        </Link>
        <Link
          href="/settings"
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            pathname === '/settings'
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
