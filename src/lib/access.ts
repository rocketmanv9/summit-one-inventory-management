// ---------------------------------------------------------------------------
// Access capability catalog — code-defined source of truth.
//
// A "capability" is a coarse unit of access. Today capabilities map 1:1 to the
// top-level nav sections (see src/lib/nav.ts `capability` field). The DB table
// public.position_capabilities stores which of these keys each HR position is
// granted; this catalog gives them stable keys + human labels.
//
// Used by the "view as position" preview: the top-nav picker lets you preview
// the app as a given position, and the sidebar/settings show only the sections
// that position's capability set allows. This is PREVIEW ONLY (client-side
// show/hide) — it does not enforce server-side permissions.
// ---------------------------------------------------------------------------

export interface AccessCapability {
  key: string;
  label: string;
  /** Short description shown in the access editor. */
  description: string;
  /** Editor grouping. */
  group: 'Sections (view)' | 'Purchasing & Vendors';
  /**
   * 'view' = controls what's shown (sidebar section / page).
   * 'action' = controls a mutating action; enforced in the UI AND server-side.
   */
  kind: 'view' | 'action';
}

// View capabilities map 1:1 to top-level nav sections (src/lib/nav.ts).
export const SECTION_CAPABILITIES: AccessCapability[] = [
  { key: 'dashboard', label: 'Dashboard', description: 'Home dashboard and KPIs', group: 'Sections (view)', kind: 'view' },
  { key: 'isabelle', label: 'Isabelle (AI)', description: 'The AI assistant', group: 'Sections (view)', kind: 'view' },
  { key: 'inventory', label: 'Inventory', description: 'Stock, items, categories, locations, movements, alerts', group: 'Sections (view)', kind: 'view' },
  { key: 'assets', label: 'Assets', description: 'Assets, tools, vehicles, equipment', group: 'Sections (view)', kind: 'view' },
  { key: 'purchasing', label: 'Purchasing', description: 'View purchase orders, vendors & vendor items', group: 'Sections (view)', kind: 'view' },
  { key: 'operations', label: 'Operations', description: 'Transfers, reservations, cycle counts, scan, network', group: 'Sections (view)', kind: 'view' },
  { key: 'audit', label: 'Audit', description: 'Ledger and data integrity', group: 'Sections (view)', kind: 'view' },
  { key: 'settings', label: 'Settings', description: 'Tenant settings, people, integrations', group: 'Sections (view)', kind: 'view' },
];

// Fine-grained purchasing/vendor controls. Enforced in UI + server.
export const PURCHASING_CAPABILITIES: AccessCapability[] = [
  { key: 'vendors.manage', label: 'Manage vendors', description: 'Create, edit & delete vendors (incl. contacts and addresses)', group: 'Purchasing & Vendors', kind: 'action' },
  { key: 'vendors.preferred', label: 'Manage preferred vendors', description: 'Set or change the preferred vendor for an item', group: 'Purchasing & Vendors', kind: 'action' },
  { key: 'vendor_performance.view', label: 'View vendor performance', description: 'See the vendor performance scorecards', group: 'Purchasing & Vendors', kind: 'view' },
  { key: 'purchase_orders.manage', label: 'Manage purchase orders', description: 'Create, edit, send, cancel & place purchase orders', group: 'Purchasing & Vendors', kind: 'action' },
];

export const ACCESS_CAPABILITIES: AccessCapability[] = [
  ...SECTION_CAPABILITIES,
  ...PURCHASING_CAPABILITIES,
];

// Capability keys, by editor group, for rendering the matrix.
export const CAPABILITY_GROUPS: { group: AccessCapability['group']; items: AccessCapability[] }[] = [
  { group: 'Sections (view)', items: SECTION_CAPABILITIES },
  { group: 'Purchasing & Vendors', items: PURCHASING_CAPABILITIES },
];

export const ALL_CAPABILITY_KEYS: string[] = ACCESS_CAPABILITIES.map((c) => c.key);

const CAPABILITY_LABELS: Record<string, string> = Object.fromEntries(
  ACCESS_CAPABILITIES.map((c) => [c.key, c.label]),
);

export function capabilityLabel(key: string): string {
  return CAPABILITY_LABELS[key] ?? key;
}

/**
 * The capability set a position can access — DENY BY DEFAULT.
 *
 * `grant === undefined/null` means the position is UNCONFIGURED → **no access**
 * (empty set). An explicit array (even empty) is honored as-is. Full access for
 * admins / developers is NOT represented here — it's applied separately (see
 * src/lib/view-as.tsx for the client and src/lib/access-server.ts for the
 * server) so those roles can never lock themselves out.
 */
export function capabilitiesForGrant(grant: string[] | undefined | null): Set<string> {
  if (grant === undefined || grant === null) return new Set<string>();
  return new Set(grant);
}
