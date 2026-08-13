import type { ComponentType } from 'react';
import {
  LayoutDashboard,
  Bot,
  Boxes,
  Activity,
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
  Sparkles,
  Camera,
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
  /**
   * Not rendered in the tab strip, but still owns its routes: keeps the
   * section's capability gate and sidebar highlight for pages reached from
   * within a page (e.g. /inventory/categories from the Inventory page menu).
   */
  hidden?: boolean;
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
  // ── The rework (Grant, 2026-08-04): five destinations for the five jobs. ──
  // Look it up (Stock) · get more (Purchasing) · keep numbers honest (Counts) ·
  // who sells it (Vendors, under Purchasing) · who has it (Assets). Everything
  // else is folded into where it belongs (hidden tab = URL still works) or
  // parked (analytics — ask Isabelle instead). Flip hidden off to bring one back.
  {
    title: 'Inventory',
    href: '/inventory/stock',
    icon: Boxes,
    capability: 'inventory',
    tabs: [
      // The front door: search-first stock lookup with the four verbs inline
      // (adjust / transfer / order / count). Item detail is the hub for the rest.
      { title: 'Inventory', href: '/inventory/stock', icon: Boxes },
      // Folded: history reads item-first (item page + ?item= deep links).
      { title: 'Movements', href: '/inventory/movements', icon: Activity, hidden: true },
      // Parked analytics — Isabelle answers these on demand.
      { title: 'Metrics', href: '/inventory/metrics', icon: TrendingUp, hidden: true },
      // Folds into Quick Add Item review (P3); reachable by URL meanwhile.
      { title: 'Suggestions', href: '/inventory/item-suggestions', icon: Sparkles, hidden: true },
      // Hidden ownership entries — reached from the Inventory page itself.
      { title: 'Items', href: '/inventory/items', icon: Boxes, hidden: true },
      { title: 'Categories', href: '/inventory/categories', icon: Boxes, hidden: true },
      { title: 'Locations', href: '/inventory/locations', icon: Boxes, hidden: true },
    ],
  },
  {
    title: 'Purchasing',
    href: '/inventory/purchasing',
    icon: ShoppingCart,
    capability: 'purchasing',
    tabs: [
      { title: 'Purchase Orders', href: '/inventory/purchasing', icon: ShoppingCart },
      // Snap a list (snap-and-buy item 04, reworking tyler-ideas item 15):
      // photograph a handwritten supply list → AI reads it → review → draft POs.
      { title: 'Snap a List', href: '/inventory/purchasing/shopping-list', icon: Camera },
      { title: 'Approvals', href: '/inventory/purchasing/approvals', icon: ClipboardCheck },
      { title: 'Vendors', href: '/inventory/vendors', icon: Users },
      { title: 'Vendor Items', href: '/inventory/vendor-items', icon: PackageSearch },
      // Group-first buying-access workflow (snap-and-buy item 03): buyable-thing
      // cards + setup wizard + access grid. The ONE editor for buyable groups —
      // /settings/buyable-groups redirects here.
      { title: 'Buying Access', href: '/inventory/buying-access', icon: ShieldCheck },
      // Parked analytics — ask Isabelle "which vendor keeps shorting us?".
      { title: 'Vendor Performance', href: '/inventory/vendor-performance', icon: TrendingUp, capability: 'vendor_performance.view', hidden: true },
    ],
  },
  {
    title: 'Counts',
    href: '/inventory/cycle-counts',
    icon: ClipboardCheck,
    capability: 'operations',
    tabs: [
      { title: 'Cycle Counts', href: '/inventory/cycle-counts', icon: ClipboardCheck },
      { title: 'Count Schedule', href: '/inventory/count-schedule', icon: CalendarDays },
      { title: 'Scan', href: '/scan', icon: ScanLine },
      // Folded: transfer is a stock-row action; reservations are ops-automated
      // and shown on the item page. Pages stay for deep links.
      { title: 'Transfers', href: '/inventory/transfers', icon: ArrowLeftRight, hidden: true },
      { title: 'Reservations', href: '/inventory/reservations', icon: CalendarCheck, hidden: true },
      { title: 'Network', href: '/operations/globe', icon: Globe, hidden: true },
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
  // Audit section parked: the ledger folded into item history (item page +
  // /inventory/audit stays live by URL); integrity becomes a background alert.
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
    // Count Qualifications merged into Position Access (2026-07-29) — the old
    // /settings/count-qualifications URL redirects there.
    { title: 'Position Access', href: '/settings/access', icon: ShieldCheck },
    // Hidden per Grant (2026-07-24): nobody knows what these mean, so they're
    // out of the tab strip. Pages still exist and deep-links still work —
    // flip hidden off to bring one back.
    { title: 'Guardrails', href: '/settings/guardrails', icon: ShieldCheck, hidden: true },
    { title: 'Negative Inventory', href: '/settings/negative-inventory', icon: ShieldAlert, hidden: true },
    { title: 'UOM Conversions', href: '/settings/uom-conversions', icon: Ruler, hidden: true },
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
