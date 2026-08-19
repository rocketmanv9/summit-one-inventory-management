'use client';

/**
 * StartWarModal — the "Start a price war" flow (inventory-fixes sprint, item 02).
 *
 * Pick the vendors, add a few products with quantities like a mini purchase
 * order, then open the war and (optionally) draft one RFQ per vendor listing all
 * the products. Everything is driven off the candidate list the page already
 * loaded, so we only ever offer products that have 2+ vendor prices and vendors
 * that actually price the chosen products.
 *
 * On submit it POSTs /api/inventory/price-wars/requests (one parent + one round
 * per product), then POSTs /requests/[id]/draft-rfq when "draft the invites" is
 * checked. It never sends anything — drafting only.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Swords,
  Loader2,
  Search,
  Crown,
  Check,
  X,
  Plus,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { apiWrite } from '@/lib/api-client';

interface VendorPrice {
  vendor_id: string;
  vendor_name: string;
  contact_email: string | null;
  best_unit_cost: number;
  is_low: boolean;
}

interface Candidate {
  catalog_item_id: string;
  name: string;
  sku: string | null;
  vendor_count: number;
  qty_last_12m: number;
  vendors: VendorPrice[];
  open_round_id: string | null;
}

const money = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? '—'
    : `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function readJson(res: Response) {
  const text = await res.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { error: text }; }
  if (!res.ok) {
    return { ok: false as const, message: json?.error?.message || json?.error || json?.message || `Request failed (${res.status})`, json };
  }
  return { ok: true as const, json };
}

export function StartWarModal({
  open,
  candidates,
  onClose,
  onStarted,
  initialPicks,
  initialVendorIds,
  title,
  description,
}: {
  open: boolean;
  candidates: Candidate[];
  onClose: () => void;
  /** Called with the anchor round id once a war is open, to jump into the arena. */
  onStarted: (anchorRoundId: string | null, requestId: string) => void;
  /**
   * Seed the product picks when the modal opens — product id → target qty
   * (0/absent = auto). Only ids that are actually startable candidates take.
   * Used by the PO-create "make vendors compete" handoff so the war opens with
   * the PO's lines already staged. Applied once per open.
   */
  initialPicks?: Record<string, number>;
  /**
   * Vendors to force-select on open (e.g. the PO's chosen vendor), on top of the
   * default "vendors that price everything" selection. Only vendors eligible for
   * the seeded picks take effect. Applied once per open.
   */
  initialVendorIds?: string[];
  /** Override the modal heading/subtext for the handoff context. */
  title?: string;
  description?: string;
}) {
  const [query, setQuery] = useState('');
  // product id → target qty (string so the input is controllable / clearable).
  const [picked, setPicked] = useState<Record<string, string>>({});
  // vendor id → selected.
  const [vendorSel, setVendorSel] = useState<Record<string, boolean>>({});
  const [draftInvites, setDraftInvites] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Apply the caller's seeds once each time the modal opens (not on every
  // candidate refresh), so the user's edits inside the modal aren't clobbered.
  const seededForOpen = useRef(false);

  // Only items with 2+ prices and no live war are startable here.
  const startable = useMemo(
    () => candidates.filter((c) => !c.open_round_id && c.vendors.length >= 2),
    [candidates],
  );

  // Reset the "seeded this open" latch whenever the modal closes so the next
  // open re-applies the caller's seeds.
  useEffect(() => {
    if (!open) seededForOpen.current = false;
  }, [open]);

  // Seed the picks (and vendor selection) once per open from the caller. Only
  // ids that are genuinely startable candidates take — anything the PO carried
  // that has fewer than two vendor prices simply isn't offered here.
  useEffect(() => {
    if (!open || seededForOpen.current) return;
    // Wait for candidates to have loaded before seeding, so the ids can match.
    if (startable.length === 0 && (initialPicks && Object.keys(initialPicks).length > 0)) return;
    seededForOpen.current = true;

    if (initialPicks && Object.keys(initialPicks).length > 0) {
      const startableIds = new Set(startable.map((c) => c.catalog_item_id));
      const seededPicks: Record<string, string> = {};
      for (const [id, qty] of Object.entries(initialPicks)) {
        if (!startableIds.has(id)) continue;
        seededPicks[id] = qty > 0 ? String(Math.round(qty)) : '';
      }
      if (Object.keys(seededPicks).length > 0) setPicked(seededPicks);
    }

    if (initialVendorIds && initialVendorIds.length > 0) {
      const sel: Record<string, boolean> = {};
      for (const id of initialVendorIds) sel[id] = true;
      setVendorSel(sel);
    }
  }, [open, startable, initialPicks, initialVendorIds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return startable;
    return startable.filter((c) => c.name.toLowerCase().includes(q) || (c.sku ?? '').toLowerCase().includes(q));
  }, [startable, query]);

  const pickedItems = useMemo(
    () => startable.filter((c) => picked[c.catalog_item_id] !== undefined),
    [startable, picked],
  );

  // Vendors that price EVERY picked product — the ones we can default-select.
  // (A vendor must have a row on all chosen items, or the round for the item it
  // doesn't price would reject it.)
  const eligibleVendors = useMemo(() => {
    if (pickedItems.length === 0) return [] as VendorPrice[];
    const [first, ...rest] = pickedItems;
    let common = new Map(first.vendors.map((v) => [v.vendor_id, v]));
    for (const item of rest) {
      const ids = new Set(item.vendors.map((v) => v.vendor_id));
      common = new Map(Array.from(common).filter(([id]) => ids.has(id)));
    }
    return Array.from(common.values()).sort((a, b) => a.vendor_name.localeCompare(b.vendor_name));
  }, [pickedItems]);

  const togglePick = (c: Candidate) => {
    setPicked((prev) => {
      const next = { ...prev };
      if (next[c.catalog_item_id] !== undefined) {
        delete next[c.catalog_item_id];
      } else {
        next[c.catalog_item_id] = c.qty_last_12m > 0 ? String(Math.round(c.qty_last_12m)) : '';
      }
      return next;
    });
    // Reset vendor selection so it re-defaults to the new common set.
    setVendorSel({});
  };

  const selectedVendorIds = useMemo(
    () => eligibleVendors.filter((v) => vendorSel[v.vendor_id] ?? true).map((v) => v.vendor_id),
    [eligibleVendors, vendorSel],
  );

  const canStart = pickedItems.length >= 1 && selectedVendorIds.length >= 2 && !busy;

  const start = async () => {
    if (!canStart) return;
    setBusy(true);
    setError('');
    try {
      const lines = pickedItems.map((c) => {
        const raw = picked[c.catalog_item_id];
        const n = Number(raw);
        return {
          catalog_item_id: c.catalog_item_id,
          ...(raw !== '' && Number.isFinite(n) && n > 0 ? { target_qty: n } : {}),
        };
      });
      const res = await apiWrite('/api/inventory/price-wars/requests', {
        method: 'POST',
        body: { vendor_ids: selectedVendorIds, lines },
      });
      const result = await readJson(res);
      if (!result.ok) { setError(result.message); return; }
      const requestId: string = result.json.data?.request_id;
      const anchor: string | null = result.json.data?.anchor_round_id ?? null;

      if (draftInvites && requestId) {
        const dRes = await apiWrite(`/api/inventory/price-wars/requests/${requestId}/draft-rfq`, {
          method: 'POST',
          body: {},
        });
        // A drafting failure shouldn't strand the opened war — surface it but
        // still hand off to the arena.
        const d = await readJson(dRes);
        if (!d.ok) setError(`War opened, but drafting the invites failed: ${d.message}`);
      }
      onStarted(anchor, requestId);
    } catch (e: any) {
      setError(e?.message || 'Could not start the price war.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl gap-0 overflow-hidden p-0">
        <div className="border-b bg-background px-6 pb-4 pt-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Swords className="h-5 w-5 text-primary" /> {title ?? 'Start a price war'}
            </DialogTitle>
            <DialogDescription>
              {description ??
                'Pick a couple of vendors, add the products you want them to bid on, and we’ll draft one invitation per vendor. Nothing is sent — you copy the drafts and send them yourself.'}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-5">
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
            </div>
          )}

          {/* ── Step 1: products ── */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">1 · Products to fight over</h3>

            {pickedItems.length > 0 && (
              <div className="mb-3 space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-2.5">
                {pickedItems.map((c) => (
                  <div key={c.catalog_item_id} className="flex items-center gap-2">
                    <div className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">
                      {c.name}
                      {c.sku && <span className="ml-1.5 font-mono text-[11px] text-gray-400">{c.sku}</span>}
                    </div>
                    <label className="flex items-center gap-1 text-xs text-gray-500">
                      qty
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={picked[c.catalog_item_id]}
                        onChange={(e) => setPicked((p) => ({ ...p, [c.catalog_item_id]: e.target.value }))}
                        placeholder="auto"
                        className="w-24 rounded border border-gray-300 px-2 py-1 text-sm"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => togglePick(c)}
                      className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
                      aria-label="Remove product"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search items with two or more vendor prices…"
                className="h-9 w-full rounded-lg border border-gray-300 pl-9 pr-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>

            {filtered.length === 0 ? (
              <p className="rounded-md border border-dashed border-gray-300 p-4 text-center text-xs text-gray-500">
                {startable.length === 0
                  ? 'No items are ready to fight over — add a second vendor price to an item first.'
                  : 'No matches.'}
              </p>
            ) : (
              <ul className="max-h-48 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200">
                {filtered.map((c) => {
                  const isPicked = picked[c.catalog_item_id] !== undefined;
                  return (
                    <li key={c.catalog_item_id}>
                      <button
                        type="button"
                        onClick={() => togglePick(c)}
                        className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-primary/5 ${isPicked ? 'bg-emerald-50/60' : 'bg-white'}`}
                      >
                        <span className="min-w-0 truncate">
                          <span className="font-medium text-gray-900">{c.name}</span>
                          <span className="ml-1.5 text-[11px] text-gray-400">{c.vendors.length} vendors</span>
                        </span>
                        {isPicked ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600"><Check className="h-3.5 w-3.5" /> added</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary"><Plus className="h-3.5 w-3.5" /> add</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* ── Step 2: vendors ── */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">2 · Vendors in the ring</h3>
            {pickedItems.length === 0 ? (
              <p className="rounded-md border border-dashed border-gray-300 p-4 text-center text-xs text-gray-500">
                Add a product first — then pick from the vendors that price it.
              </p>
            ) : eligibleVendors.length < 2 ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 p-4 text-center text-xs text-amber-700">
                Fewer than two vendors price all {pickedItems.length} chosen products. Drop a product, or pick items that share vendors.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {eligibleVendors.map((v) => {
                  const on = vendorSel[v.vendor_id] ?? true;
                  return (
                    <button
                      key={v.vendor_id}
                      type="button"
                      onClick={() => setVendorSel((s) => ({ ...s, [v.vendor_id]: !on }))}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition ${
                        on ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
                      }`}
                      title={v.contact_email ?? 'No contact email on file'}
                    >
                      {on ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                      {v.is_low && <Crown className="h-3.5 w-3.5 text-amber-500" />}
                      {v.vendor_name}
                    </button>
                  );
                })}
              </div>
            )}
            {eligibleVendors.length >= 2 && selectedVendorIds.length < 2 && (
              <p className="mt-2 text-xs text-amber-600">Pick at least two vendors — one vendor isn&apos;t a war.</p>
            )}
          </section>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center gap-3 border-t bg-background px-6 py-4">
          <label className="inline-flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={draftInvites} onChange={(e) => setDraftInvites(e.target.checked)} className="rounded border-gray-300" />
            <Sparkles className="h-4 w-4 text-primary" /> Draft the invitation emails now
          </label>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={onClose} className="rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">
              Cancel
            </button>
            <button
              type="button"
              onClick={start}
              disabled={!canStart}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Swords className="h-4 w-4" />}
              Start war{pickedItems.length > 1 ? ` · ${pickedItems.length} products` : ''}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
