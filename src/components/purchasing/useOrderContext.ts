'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** An honest price hint for one catalog item, or null when nothing is known. */
export interface PriceHint {
  unit_cost: number;
  date: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
}

/** Stock at one yard for one item — available = on hand − reserved. */
export interface StockAtLocation {
  location_id: string;
  location_name: string | null;
  on_hand: number;
  reserved: number;
  available: number;
}

/** A live PO already covering an item — feeds the "already on order" flag. */
export interface OpenPO {
  po_id: string;
  po_number: string | null;
  status: string;
  qty_outstanding: number;
  placed_at: string | null;
  vendor_name: string | null;
}

export interface ItemOrderContext {
  catalog_item_id: string;
  last_paid: PriceHint | null;
  catalog_price: { unit_cost: number; vendor_id: string | null; vendor_name: string | null } | null;
  /** Available stock at the destination yard, when a location is in play. */
  stock_here?: StockAtLocation | null;
  /** Other yards with available stock, best (most available) first. */
  stock_elsewhere?: StockAtLocation[];
  /** Live POs already covering this item, newest first. */
  open_pos?: OpenPO[];
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

/** One advisory "do you really need to buy this?" flag for a PO line. */
export interface SmartFlag {
  kind: 'on_hand' | 'surplus' | 'on_order';
  text: string;
  /** Surplus flags carry a transfer prefill for the "Start transfer" action. */
  transfer?: { fromLocationId: string; toLocationId: string; qty: number };
  /** On-order flags link to the covering PO. */
  poId?: string;
}

// Below this, an on-hand/surplus quantity is noise, not a reason to skip a
// buy — don't flag a stray unit or two sitting at a far yard.
const SURPLUS_MIN = 2;

/**
 * Advisory flags for one PO line: stock already available at the destination
 * yard, unreserved surplus at another yard worth transferring instead, and any
 * open PO already covering the item. All derived from the item's order context;
 * returns [] when nothing is worth surfacing.
 */
export function computeFlags(
  ctx: ItemOrderContext | null | undefined,
  opts: { destinationLocationId: string | null; qtyOrdered: number },
): SmartFlag[] {
  if (!ctx) return [];
  const { destinationLocationId, qtyOrdered } = opts;
  const flags: SmartFlag[] = [];

  // Already on hand at the destination yard.
  const here = ctx.stock_here;
  if (here && here.available > 0) {
    const where = here.location_name || 'this yard';
    flags.push({
      kind: 'on_hand',
      text: `Already ${fmtQty(here.available)} available at ${where}${
        here.reserved > 0 ? ` (${fmtQty(here.on_hand)} on hand, ${fmtQty(here.reserved)} reserved)` : ''
      }.`,
    });
  }

  // Surplus at another yard: suggest a transfer. Best (most available) yard is
  // first from the API. Flag when it can cover the order, or a meaningful chunk
  // of it (≥ half), so a partial-cover transfer still gets offered.
  const elsewhere = (ctx.stock_elsewhere ?? []).filter((s) => s.available >= SURPLUS_MIN);
  const best = elsewhere[0];
  const wanted = qtyOrdered > 0 ? qtyOrdered : SURPLUS_MIN;
  if (best && destinationLocationId && best.available >= Math.min(wanted, Math.ceil(wanted / 2))) {
    const coverable = Math.min(best.available, wanted);
    const more = elsewhere.length - 1;
    flags.push({
      kind: 'surplus',
      text: `${best.location_name || 'Another yard'} has ${fmtQty(best.available)} unreserved${
        more > 0 ? ` (+${more} more yard${more > 1 ? 's' : ''})` : ''
      } — transfer instead?`,
      transfer: {
        fromLocationId: best.location_id,
        toLocationId: destinationLocationId,
        qty: Math.max(1, Math.round(coverable)),
      },
    });
  }

  // Already on an open PO.
  const openPo = (ctx.open_pos ?? [])[0];
  if (openPo && openPo.qty_outstanding > 0) {
    const when = openPo.placed_at ? ` (${formatShortDate(openPo.placed_at)}` : '';
    const who = openPo.vendor_name ? `${when ? ', ' : ' ('}${openPo.vendor_name}` : '';
    const tail = when || who ? `${when}${who})` : '';
    flags.push({
      kind: 'on_order',
      text: `${fmtQty(openPo.qty_outstanding)} already on open PO ${
        openPo.po_number ? `#${openPo.po_number}` : ''
      }${tail}`.replace(/\s+/g, ' ').trim() + '.',
      poId: openPo.po_id,
    });
  }

  return flags;
}

/** Whole numbers plain, fractional to two places. */
function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
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
