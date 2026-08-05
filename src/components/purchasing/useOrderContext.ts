'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** An honest price hint for one catalog item, or null when nothing is known. */
export interface PriceHint {
  unit_cost: number;
  date: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
}

export interface ItemOrderContext {
  catalog_item_id: string;
  last_paid: PriceHint | null;
  catalog_price: { unit_cost: number; vendor_id: string | null; vendor_name: string | null } | null;
}

export interface SuggestedVendor {
  vendor_id: string;
  vendor_name: string | null;
  reason: string;
}

interface OrderContextResult {
  items: Record<string, ItemOrderContext>;
  suggested_vendor: SuggestedVendor | null;
}

/**
 * Loads price hints (last paid / catalog list) for a set of catalog items, and
 * — when a location is supplied — the best vendor to default the PO to. Batches
 * item ids into one request and caches per item so adding/removing lines only
 * fetches what's new. Reads the server route (cross-schema, prod-safe) rather
 * than the browser RPCs.
 */
export function useOrderContext() {
  const [hints, setHints] = useState<Record<string, ItemOrderContext | null>>({});
  const [suggestedVendor, setSuggestedVendor] = useState<SuggestedVendor | null>(null);
  // Items already fetched (or in flight) so we never re-request them.
  const requested = useRef<Set<string>>(new Set());

  const fetchContext = useCallback(async (itemIds: string[], locationId?: string | null) => {
    const missing = itemIds.filter((id) => id && !requested.current.has(id));
    // Re-fetch when a location is provided (it changes the suggested vendor) or
    // there are new items to price.
    if (missing.length === 0 && !locationId) return;
    for (const id of missing) requested.current.add(id);

    const idsToFetch = locationId ? itemIds.filter(Boolean) : missing;
    if (idsToFetch.length === 0) return;

    try {
      const params = new URLSearchParams({ item_ids: idsToFetch.join(',') });
      if (locationId) params.set('location_id', locationId);
      const res = await fetch(`/api/inventory/purchasing/order-context?${params.toString()}`, {
        credentials: 'include',
      });
      if (!res.ok) return;
      const json: { data?: OrderContextResult } = await res.json();
      const data = json.data;
      if (!data) return;
      setHints((prev) => {
        const next = { ...prev };
        for (const id of idsToFetch) next[id] = data.items[id] ?? null;
        return next;
      });
      if (data.suggested_vendor) setSuggestedVendor(data.suggested_vendor);
    } catch {
      /* hints are advisory — a failure just means no hint shows */
    }
  }, []);

  return { hints, suggestedVendor, fetchContext };
}

/** "Last paid $12.40 on Jun 12 from ACME" etc. — plain-English hint text. */
export function formatHint(
  ctx: ItemOrderContext | null | undefined,
  opts?: { selectedVendorName?: string | null },
): { text: string; price: number | null } {
  if (ctx?.last_paid) {
    const lp = ctx.last_paid;
    const when = lp.date ? formatShortDate(lp.date) : null;
    const who = lp.vendor_name ? ` from ${lp.vendor_name}` : '';
    const diffVendor =
      opts?.selectedVendorName && lp.vendor_name && opts.selectedVendorName !== lp.vendor_name
        ? ' (different vendor)'
        : '';
    return {
      text: `Last paid ${money(lp.unit_cost)}${when ? ` on ${when}` : ''}${who}${diffVendor}`,
      price: lp.unit_cost,
    };
  }
  if (ctx?.catalog_price) {
    return {
      text: `Catalog: ${money(ctx.catalog_price.unit_cost)} (vendor list price)`,
      price: ctx.catalog_price.unit_cost,
    };
  }
  return { text: 'Never purchased — no price estimate.', price: null };
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function formatShortDate(iso: string): string {
  // Accept a date ('2026-06-12') or a timestamp; show "Jun 12".
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
