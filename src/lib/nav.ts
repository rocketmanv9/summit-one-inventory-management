import type { ComponentType } from 'react';
import {
  LayoutDashboard,
  Bot,
  Boxes,
  Package,
  Tags,
  MapPin,
  Activity,
  LineChart,
  AlertTriangle,
  BarChart3,
  Truck,
  Wrench,
  Car,
  Construction,
  ShoppingCart,
  Users,
  PackageSearch,
  TrendingUp,
  ArrowLeftRight,
  CalendarCheck,
  ClipboardCheck,
  CalendarDays,
  ScanLine,
  Globe,
  History,
  ShieldCheck,
  Settings,
  Wallet,
  Palette,
  Smartphone,
  Plug,
  ShieldAlert,
  Tag,
  Ruler,
  Bug,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Single source of truth for ALL navigation.
//
// The sidebar renders one link per section (the section's landing page).
// PageTabs renders the section's `tabs` as an in-page tab strip when you're
// anywhere inside that section. This is the one nav pattern used everywhere —
// no per-page nav components, no duplicated tab lists.
// ---------------------------------------------------------------------------

type Icon = ComponentType<{ className?: string }>;

export interface NavTab {
  title: string;
  href: string;
  icon: Icon;
  /** Visible only to developer sessions. */
  requiresDeveloper?: boolean;
  /** Visible only to admins or developers. */
  requiresAdminOrDev?: boolean;
  /**
   * Access capability key (see src/lib/access.ts). Hides the tab in the
   * "view as" preview and for real users whose position lacks it.
   */
  capability?: string;
  /** Opens in a new tab (external tool). */
  external?: boolean;
}

export interface NavSection {
  /** Sidebar label. */
  title: string;
  /** Sidebar destination — the section's landing page (usually tabs[0]). */
  href: string;
  icon: Icon;
  requiresDeveloper?: boolean;
  /**
   * Access capability key (see src/lib/access.ts). Gates the section in the
   * "view as position" preview. Sections without a key are always shown.
   */
  capability?: string;
  /** In-page tab strip. A single-tab section shows no strip. */
  tabs: NavTab[];
}

// Top-level destinations shown in the sidebar, in order.
export const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
    capability: 'dashboard',
    tabs: [{ title: 'Dashboard', href: '/dashboard', icon: LayoutDashboard }],
  },
  {
    title: 'Isabelle',
    href: '/ai',
    icon: Bot,
    capability: 'isabelle',
    tabs: [{ title: 'Isabelle', href: '/ai', icon: Bot }],
  },
  {
    title: 'Inventory',
    href: '/inventory/stock',
    icon: Boxes,
    capability: 'inventory',
    tabs: [
      { title: 'Stock Balances', href: '/inventory/stock', icon: Boxes },
      { title: 'Items', href: '/inventory/items', icon: Package },
      { title: 'Categories', href: '/inventory/categories', icon: Tags },
      { title: 'Locations', href: '/inventory/locations', icon: MapPin },
      { title: 'Movements', href: '/inventory/movements', icon: Activity },
      { title: 'Usage Trends', href: '/inventory/usage-trends', icon: LineChart },
      { title: 'Alerts', href: '/inventory/alerts', icon: AlertTriangle },
      { title: 'ABC Classification', href: '/inventory/abc-classification', icon: BarChart3 },
    ],
  },
  {
    title: 'Assets',
    href: '/inventory/assets',
    icon: Truck,
    capability: 'assets',
    tabs: [
      { title: 'Assets', href: '/inventory/assets', icon: Truck },
      { title: 'Tools', href: '/fleet/tools', icon: Wrench },
      { title: 'Vehicles', href: '/fleet/vehicles', icon: Car },
      { title: 'Equipment', href: '/fleet/equipment', icon: Construction },
    ],
  },
  {
    title: 'Purchasing',
    href: '/inventory/purchasing',
    icon: ShoppingCart,
    capability: 'purchasing',
    tabs: [
      { title: 'Purchase Orders', href: '/inventory/purchasing', icon: ShoppingCart },
      { title: 'Vendors', href: '/inventory/vendors', icon: Users },
      { title: 'Vendor Items', href: '/inventory/vendor-items', icon: PackageSearch },
      { title: 'Vendor Performance', href: '/inventory/vendor-performance', icon: TrendingUp, capability: 'vendor_performance.view' },
    ],
  },
  {
    title: 'Operations',
    href: '/inventory/transfers',
    icon: ArrowLeftRight,
    capability: 'operations',
    tabs: [
      { title: 'Transfers', href: '/inventory/transfers', icon: ArrowLeftRight },
      { title: 'Reservations', href: '/inventory/reservations', icon: CalendarCheck },
      { title: 'Cycle Counts', href: '/inventory/cycle-counts', icon: ClipboardCheck },
      { title: 'Count Schedule', href: '/inventory/count-schedule', icon: CalendarDays },
      { title: 'Scan', href: '/scan', icon: ScanLine },
      { title: 'Network', href: '/operations/globe', icon: Globe },
    ],
  },
  {
    title: 'Audit',
    href: '/inventory/audit',
    icon: History,
    capability: 'audit',
    tabs: [
      { title: 'Ledger', href: '/inventory/audit', icon: History },
      { title: 'Data Integrity', href: '/inventory/integrity', icon: ShieldCheck },
    ],
  },
];

// Settings lives in the sidebar footer but uses the same tab pattern.
export const SETTINGS_SECTION: NavSection = {
  title: 'Settings',
  href: '/settings',
  icon: Settings,
  capability: 'settings',
  // Ordered in loose groups: org & people → inventory rules → connections.
  tabs: [
    { title: 'General', href: '/settings', icon: Settings },
    { title: 'My Spending', href: '/settings/my-spending', icon: Wallet },
    { title: 'People & Limits', href: '/settings/people', icon: Users },
    { title: 'Position Access', href: '/settings/access', icon: ShieldCheck },
    { title: 'Count Qualifications', href: '/settings/count-qualifications', icon: ClipboardCheck },
    { title: 'Guardrails', href: '/settings/guardrails', icon: ShieldCheck },
    { title: 'Negative Inventory', href: '/settings/negative-inventory', icon: ShieldAlert },
    { title: 'UOM Conversions', href: '/settings/uom-conversions', icon: Ruler },
    { title: 'Reservation Types', href: '/settings/reservation-types', icon: CalendarCheck },
    { title: 'Assignment Types', href: '/settings/assignment-types', icon: Tag },
    { title: 'Branding', href: '/settings/branding', icon: Palette },
    { title: 'Device Management', href: '/settings/device-management', icon: Smartphone },
    { title: 'Integrations', href: '/settings/integrations', icon: Plug },
    {
      title: 'Assistant',
      // Externally-hosted OpenClaw maintenance assistant (Cloudflare Access-gated).
      // Dev tool that can edit the codebase — admins/developers only, new tab.
      href: 'https://claw.forge-operation.com',
      icon: Wrench,
      requiresAdminOrDev: true,
      external: true,
    },
  ],
};

// Dev-only utility link, shown in the footer for developer sessions only.
export const DEBUG_ITEM: NavTab = {
  title: 'Debug',
  href: '/debug',
  icon: Bug,
  requiresDeveloper: true,
};

const TAB_OWNERS: NavSection[] = [...NAV_SECTIONS, SETTINGS_SECTION];

/** Every top-level section (sidebar + settings), in nav order. */
export const ALL_NAV_SECTIONS: NavSection[] = TAB_OWNERS;

/** True when `pathname` is `href` or a child route of it. */
export function matchHref(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/');
}

/** The section whose tabs contain the current path, or null. */
function findOwningSection(pathname: string): NavSection | null {
  for (const section of TAB_OWNERS) {
    if (section.tabs.some((t) => !t.external && matchHref(pathname, t.href))) {
      return section;
    }
  }
  return null;
}

/**
 * The section that owns `pathname` (sidebar or settings), or null when the path
 * isn't under any section's tabs. Used by the access guard to find the
 * capability that gates the current page.
 */
export function sectionForPath(pathname: string): NavSection | null {
  return findOwningSection(pathname);
}

/** Tabs to show for the current path, or null when there's no strip to show. */
export function findTabGroup(pathname: string): NavTab[] | null {
  const section = findOwningSection(pathname);
  if (!section || section.tabs.length <= 1) return null;
  return section.tabs;
}

/** A section is active in the sidebar when the path lives in any of its tabs. */
export function isSectionActive(pathname: string, section: NavSection): boolean {
  if (matchHref(pathname, section.href)) return true;
  return section.tabs.some((t) => !t.external && matchHref(pathname, t.href));
}

export function isTabActive(pathname: string, href: string): boolean {
  return matchHref(pathname, href);
}
