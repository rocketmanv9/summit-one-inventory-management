'use client';

/**
 * Shared types + display logic for the buying-access rework (item 03, snap-and-
 * buy sprint). One place turns an item's server-computed `resolution` (from
 * /api/inventory/buyable-groups/overview) into the plain-words sentence Grant
 * asked for — "how does this ACTUALLY get bought?" — so the group cards, the
 * wizard, and the access grid all tell the same story.
 */

import { ExternalLink, ShoppingCart, Tag } from 'lucide-react';
import type { ReactNode } from 'react';

export type FulfillmentKind = 'catalog' | 'vendor_item' | 'external_link';

/** Server-computed per-item resolution (see /buyable-groups/overview). */
export interface ItemResolution {
  kind: FulfillmentKind;
  // catalog
  admin_vendor_name?: string | null;
  vendor_id?: string | null;
  vendor_name?: string | null;
  unit_cost?: number | null;
  vendor_is_preferred?: boolean;
  // vendor_item
  pin_ok?: boolean;
  // external_link
  has_fallback?: boolean;
  link_label?: string | null;
  people_total?: number;
  people_covered?: number;
  links_total?: number;
}

export interface OverviewItem {
  id: string;
  catalog_item_id: string;
  default_qty: number;
  preferred_vendor_id: string | null;
  sort_order: number;
  fulfillment_kind: FulfillmentKind;
  external_url: string | null;
  link_label: string | null;
  vendor_item_id: string | null;
  name: string | null;
  sku: string | null;
  uom_term_id: string | null;
  resolution: ItemResolution;
}

export interface OverviewGroup {
  id: string;
  name: string;
  description: string | null;
  allowed_positions: string[];
  active: boolean;
  sort_order: number;
  items: OverviewItem[];
}

export const money = (n: number | null | undefined) =>
  n == null ? null : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export const KIND_META: Record<FulfillmentKind, { label: string; Icon: typeof ShoppingCart; chip: string }> = {
  catalog: { label: 'Catalog', Icon: ShoppingCart, chip: 'bg-sky-50 text-sky-700 border-sky-200' },
  vendor_item: { label: 'Vendor item', Icon: Tag, chip: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  external_link: { label: 'Link', Icon: ExternalLink, chip: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
};

export function KindBadge({ kind, className = '' }: { kind: FulfillmentKind; className?: string }) {
  const meta = KIND_META[kind];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${meta.chip} ${className}`}>
      <meta.Icon className="h-2.5 w-2.5" /> {meta.label}
    </span>
  );
}

/**
 * The plain-words answer to "what happens when someone buys this?", plus
 * whether it's a warning state. Mirrors the ACTUAL /request drafting rules:
 * pinned vendor_items row → admin vendor pin → best vendor_items row →
 * free-text lines on the "Guided Purchase" placeholder PO. Never silent about
 * the placeholder path.
 */
export function resolutionSummary(item: OverviewItem): { text: string; warn: boolean } {
  const r = item.resolution;

  if (r.kind === 'external_link') {
    const label = r.link_label || item.link_label || 'external link';
    const total = r.people_total ?? 0;
    const covered = r.people_covered ?? 0;
    if (total === 0) {
      // Admins-only group (or no active people in the allowed positions).
      return r.has_fallback
        ? { text: `Opens "${label}" (shared link)`, warn: false }
        : {
            text: `Opens "${label}" — personal links only (${r.links_total ?? 0} on file), no shared fallback`,
            warn: (r.links_total ?? 0) === 0,
          };
    }
    if (r.has_fallback) {
      return {
        text: `Opens "${label}" — personal link for ${covered} of ${total} people, everyone else gets the shared link`,
        warn: false,
      };
    }
    if (covered >= total) {
      return { text: `Opens each person's "${label}" — all ${total} people set up`, warn: false };
    }
    return {
      text: `Opens each person's "${label}" — NOT set up for ${total - covered} of ${total} people (no shared fallback)`,
      warn: true,
    };
  }

  if (r.kind === 'vendor_item') {
    if (!r.pin_ok) {
      return {
        text: 'Pinned vendor item is missing or inactive — drafting falls back to normal vendor resolution',
        warn: true,
      };
    }
    const price = money(r.unit_cost);
    return {
      text: `Draft PO to ${r.vendor_name ?? 'vendor'}${price ? ` @ ${price}` : ''} (pinned vendor item)`,
      warn: false,
    };
  }

  // catalog
  if (r.admin_vendor_name) {
    return { text: `Draft PO to ${r.admin_vendor_name} (admin-pinned vendor)`, warn: false };
  }
  if (r.vendor_name) {
    const price = money(r.unit_cost);
    return r.vendor_is_preferred
      ? { text: `Draft PO to preferred vendor ${r.vendor_name}${price ? ` @ ${price}` : ''}`, warn: false }
      : { text: `PO via cheapest vendor — currently ${r.vendor_name}${price ? ` @ ${price}` : ''}`, warn: false };
  }
  return {
    text: 'No vendor known — drafts as free text onto the "Guided Purchase" placeholder PO; a buyer must assign a real vendor before approval',
    warn: true,
  };
}

/** Group-level health flags for the landing cards — worst problems first. */
export function groupHealthFlags(group: OverviewGroup): string[] {
  const flags: string[] = [];
  const noVendor = group.items.filter(
    (it) => it.resolution.kind === 'catalog' && !it.resolution.vendor_name && !it.resolution.admin_vendor_name,
  ).length;
  const deadPins = group.items.filter((it) => it.resolution.kind === 'vendor_item' && !it.resolution.pin_ok).length;
  for (const it of group.items) {
    const r = it.resolution;
    if (r.kind !== 'external_link' || r.has_fallback) continue;
    const total = r.people_total ?? 0;
    const covered = r.people_covered ?? 0;
    if (total > 0 && covered < total) {
      flags.push(`"${it.name ?? 'Link item'}" not set up for ${total - covered} of ${total} people`);
    } else if (total === 0 && (r.links_total ?? 0) === 0) {
      flags.push(`"${it.name ?? 'Link item'}" has no link at all yet`);
    }
  }
  if (deadPins > 0) flags.push(`${deadPins} pinned vendor item${deadPins === 1 ? ' is' : 's are'} missing`);
  if (noVendor > 0) flags.push(`${noVendor} item${noVendor === 1 ? '' : 's'} draft${noVendor === 1 ? 's' : ''} to the Guided Purchase placeholder — vendor needed`);
  if (group.items.length === 0) flags.push('No items yet — this group is invisible in the buying flow');
  return flags;
}

export function Chip({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${className}`}>
      {children}
    </span>
  );
}
