'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/layout/AppShell';
import { CapabilityGate } from '@/components/access/CapabilityGate';
import { PageHeader } from '@/components/ui/PageHeader';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { useUOMLabelMap } from '@/hooks/useGVTerms';
import { HowItWorksCard, HowThisWorksButton, useHowItWorks } from '@/components/ui/HowItWorksCard';
import { ShoppingCart, Sparkles, Store, AlertTriangle, Search, ClipboardPaste, Check } from 'lucide-react';

// ── Item 15: Shopping list → vendor suggestions ──────────────────────────────
// Enter a list of items (catalog search OR paste-a-list), see who to buy from
// per item and the smartest vendor split for the whole list, then one tap turns
// it into draft POs grouped by vendor. Reads /suggest, writes /draft — both reuse
// the vendor_items pricing + rpc_create_purchase_order plumbing the rest of
// purchasing uses. The list is ephemeral (client state) — nothing persisted.

interface CatalogItem {
  id: string;
  name: string;
  sku?: string | null;
  uom_term_id?: string | null;
}

interface VendorOption {
  vendor_id: string;
  vendor_name: string | null;
  unit_cost: number | null;
  is_preferred: boolean;
}

interface SuggestItem {
  catalog_item_id: string;
  name: string | null;
  sku: string | null;
  uom_term_id: string | null;
  qty: number;
  options: VendorOption[];
  recommended_vendor_id: string | null;
  last_paid: { unit_cost: number; date: string | null; vendor_name: string | null } | null;
  has_vendor: boolean;
}

interface CatalogMatch {
  query: string;
  qty: number;
  catalog_item_id: string | null;
  name: string | null;
  sku: string | null;
  uom_term_id: string | null;
  match_kind: 'exact_sku' | 'exact_name' | 'fuzzy' | 'none';
  score: number;
}

interface SplitVendorBucket {
  vendor_id: string;
  vendor_name: string | null;
  item_count: number;
  subtotal: number;
  has_unpriced: boolean;
  catalog_item_ids: string[];
}
interface VendorSplit {
  buckets: SplitVendorBucket[];
  total: number;
  unassigned_item_ids: string[];
  vendor_count: number;
}
interface SplitResult {
  recommended: VendorSplit;
  consolidated: VendorSplit | null;
  consolidation_note: string;
}

interface SuggestResponse {
  matches: CatalogMatch[];
  items: SuggestItem[];
  split: SplitResult;
}

// A line the user has put on the list: a catalog item + editable qty. The chosen
// vendor overrides the recommended one; null = "no vendor / free-text draft".
interface ListLine {
  catalog_item_id: string;
  qty: number;
  chosen_vendor_id: string | null;
}

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function ShoppingListPage() {
  const help = useHowItWorks('inventory-shopping-list-help');
  const uomLabels = useUOMLabelMap();

  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [lines, setLines] = useState<ListLine[]>([]);
  const [suggest, setSuggest] = useState<SuggestResponse | null>(null);
  const [loadingSuggest, setLoadingSuggest] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [result, setResult] = useState<{ po_count: number; po_ids: string[] } | null>(null);
  const [error, setError] = useState('');

  // Catalog search box.
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  // Paste-a-list box + its match review.
  const [pasteText, setPasteText] = useState('');
  const [pasteMatches, setPasteMatches] = useState<CatalogMatch[] | null>(null);
  const [matching, setMatching] = useState(false);

  useEffect(() => {
    InventoryRPC.getCatalogItems({ active: true, exclude_variants: true })
      .then((data) => setCatalog((data as any[]).map((c) => ({ id: c.id, name: c.name, sku: c.sku, uom_term_id: c.uom_term_id }))))
      .catch(() => {});
  }, []);

  const catalogById = useMemo(() => new Map(catalog.map((c) => [c.id, c])), [catalog]);

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    const onList = new Set(lines.map((l) => l.catalog_item_id));
    return catalog
      .filter((c) => !onList.has(c.id) && (c.name?.toLowerCase().includes(q) || c.sku?.toLowerCase().includes(q)))
      .slice(0, 8);
  }, [search, catalog, lines]);

  // Re-fetch suggestions whenever the set of line items changes (not on every
  // qty keystroke — qty only affects totals, recomputed client-side below).
  const lineKey = useMemo(() => lines.map((l) => l.catalog_item_id).sort().join(','), [lines]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (lines.length === 0) {
      setSuggest(null);
      return;
    }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggest(), 250);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineKey]);

  const fetchSuggest = async () => {
    setLoadingSuggest(true);
    setError('');
    try {
      const res = await fetch('/api/inventory/purchasing/shopping-list/suggest', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: lines.map((l) => ({ catalog_item_id: l.catalog_item_id, qty: l.qty || 1 })) }),
      });
      if (!res.ok) {
        setError((await res.json().catch(() => ({})))?.error?.message || 'Could not load suggestions');
        return;
      }
      const { data } = await res.json();
      setSuggest(data as SuggestResponse);
    } catch (e: any) {
      setError(e.message || 'Could not load suggestions');
    } finally {
      setLoadingSuggest(false);
    }
  };

  const addItem = (item: CatalogItem) => {
    setLines((prev) =>
      prev.some((l) => l.catalog_item_id === item.id) ? prev : [...prev, { catalog_item_id: item.id, qty: 1, chosen_vendor_id: null }],
    );
    setSearch('');
    setShowSearch(false);
  };

  const removeLine = (id: string) => setLines((prev) => prev.filter((l) => l.catalog_item_id !== id));
  const setQty = (id: string, qty: number) =>
    setLines((prev) => prev.map((l) => (l.catalog_item_id === id ? { ...l, qty } : l)));
  const setVendor = (id: string, vendorId: string | null) =>
    setLines((prev) => prev.map((l) => (l.catalog_item_id === id ? { ...l, chosen_vendor_id: vendorId } : l)));

  // Paste box: match lines server-side, then let the user confirm which to add.
  const runMatch = async () => {
    if (!pasteText.trim()) return;
    setMatching(true);
    setError('');
    try {
      const res = await fetch('/api/inventory/purchasing/shopping-list/suggest', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: pasteText }),
      });
      if (!res.ok) {
        setError('Could not match the list');
        return;
      }
      const { data } = await res.json();
      setPasteMatches((data as SuggestResponse).matches);
    } catch (e: any) {
      setError(e.message || 'Could not match the list');
    } finally {
      setMatching(false);
    }
  };

  const acceptMatches = () => {
    if (!pasteMatches) return;
    const matched = pasteMatches.filter((m) => m.catalog_item_id);
    setLines((prev) => {
      const next = [...prev];
      for (const m of matched) {
        const existing = next.find((l) => l.catalog_item_id === m.catalog_item_id);
        if (existing) existing.qty += m.qty;
        else next.push({ catalog_item_id: m.catalog_item_id!, qty: m.qty, chosen_vendor_id: null });
      }
      return next;
    });
    setPasteText('');
    setPasteMatches(null);
  };

  const suggestByItem = useMemo(() => new Map((suggest?.items ?? []).map((it) => [it.catalog_item_id, it])), [suggest]);

  // The effective vendor for a line = chosen override, else the recommended one.
  const effectiveVendor = (line: ListLine): string | null => {
    if (line.chosen_vendor_id !== null) return line.chosen_vendor_id;
    return suggestByItem.get(line.catalog_item_id)?.recommended_vendor_id ?? null;
  };

  // Live client-side split preview honoring qty + vendor overrides (the server
  // split is for the *recommended* assignment; this reflects what will be drafted).
  const liveSplit = useMemo(() => {
    const byVendor = new Map<string | null, { name: string | null; items: number; subtotal: number; unpriced: boolean }>();
    for (const line of lines) {
      const it = suggestByItem.get(line.catalog_item_id);
      const vId = effectiveVendor(line);
      const opt = it?.options.find((o) => o.vendor_id === vId) ?? null;
      const b = byVendor.get(vId) ?? { name: opt?.vendor_name ?? null, items: 0, subtotal: 0, unpriced: false };
      b.items += 1;
      if (opt?.unit_cost != null) b.subtotal += opt.unit_cost * (line.qty || 1);
      else b.unpriced = true;
      if (opt?.vendor_name) b.name = opt.vendor_name;
      byVendor.set(vId, b);
    }
    const buckets = [...byVendor.entries()].sort((a, b) => b[1].items - a[1].items);
    const total = buckets.reduce((s, [, b]) => s + b.subtotal, 0);
    return { buckets, total, vendorCount: buckets.filter(([v]) => v !== null).length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, suggestByItem]);

  const applyConsolidated = () => {
    if (!suggest?.split.consolidated) return;
    const con = suggest.split.consolidated!;
    // Map each item to the consolidated bucket that contains it.
    const vendorForItem = new Map<string, string>();
    for (const b of con.buckets) for (const id of b.catalog_item_ids) vendorForItem.set(id, b.vendor_id);
    setLines((prev) => prev.map((l) => ({ ...l, chosen_vendor_id: vendorForItem.get(l.catalog_item_id) ?? l.chosen_vendor_id })));
  };

  const draftPOs = async () => {
    setDrafting(true);
    setError('');
    setResult(null);
    try {
      const payload = {
        lines: lines.map((l) => {
          const it = suggestByItem.get(l.catalog_item_id);
          const vId = effectiveVendor(l);
          const opt = it?.options.find((o) => o.vendor_id === vId) ?? null;
          return {
            catalog_item_id: l.catalog_item_id,
            qty: l.qty || 1,
            vendor_id: vId,
            unit_cost: opt?.unit_cost ?? null,
          };
        }),
      };
      const res = await fetch('/api/inventory/purchasing/shopping-list/draft', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setError((await res.json().catch(() => ({})))?.error?.message || 'Could not draft POs');
        return;
      }
      const { data } = await res.json();
      const pos = data.purchase_orders ?? [];
      setResult({ po_count: pos.length, po_ids: pos.map((p: any) => p.po_id).filter(Boolean) });
      setLines([]);
      setSuggest(null);
    } catch (e: any) {
      setError(e.message || 'Could not draft POs');
    } finally {
      setDrafting(false);
    }
  };

  const noVendorItems = lines.filter((l) => effectiveVendor(l) === null);

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Shopping List"
          description="Enter what you need and get vendor suggestions — the best vendor per item, the smartest split for the whole list, and one tap to draft POs grouped by vendor."
          actions={!help.show ? <HowThisWorksButton onClick={help.open} /> : undefined}
        />

        {help.show && (
          <HowItWorksCard
            title="How the shopping list works"
            onDismiss={help.dismiss}
            steps={[
              { title: 'Build your list', body: 'Search the catalog to add items, or paste a list (one item per line — "5 crackfill boxes") and confirm the matches. Unmatched lines are flagged so nothing is lost.' },
              { title: 'See who to buy from', body: 'Each item shows its vendor options with prices and the last price you paid, with the recommended one preselected. The whole-list split shows which vendor covers what and the total.' },
              { title: 'Consolidate if it barely costs more', body: 'When buying from fewer vendors costs within 10%, we offer a "fewest vendors" alternative — fewer orders to place for about the same money.' },
              { title: 'Draft the POs', body: 'One tap creates draft purchase orders grouped by your chosen vendors. They flow through the normal approval process from there — nothing is ordered automatically.' },
            ]}
            glossary={[
              { Icon: Sparkles, term: 'Recommended vendor', blurb: 'the preferred vendor for the item, or the cheapest one on file' },
              { Icon: Store, term: 'Vendor split', blurb: 'how the list divides across vendors — one draft PO per vendor' },
              { Icon: AlertTriangle, term: 'No vendor on file', blurb: 'the item has no vendor listing yet — it goes on a placeholder draft to assign before approving' },
            ]}
          />
        )}

        {result && (
          <div className="rounded-lg border border-green-300 bg-green-50 p-4">
            <div className="flex items-center gap-2 font-medium text-green-900">
              <Check className="h-5 w-5" />
              Drafted {result.po_count} purchase order{result.po_count === 1 ? '' : 's'} grouped by vendor.
            </div>
            <div className="mt-1 text-sm text-green-800">
              They&apos;re in{' '}
              <Link href="/inventory/purchasing" className="font-semibold underline">Purchase Orders</Link>{' '}
              as drafts — review, price-check, and send from there.
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* ── Left: build the list ─────────────────────────────────────── */}
          <div className="space-y-4 lg:col-span-2">
            {/* Add via catalog search */}
            <div className="rounded-lg border bg-white p-4">
              <label className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
                <Search className="h-4 w-4" /> Add an item
              </label>
              <div className="relative">
                <input
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setShowSearch(true); }}
                  onFocus={() => setShowSearch(true)}
                  placeholder="Search the catalog by name or SKU…"
                  className="w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                />
                {showSearch && searchResults.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-white shadow-lg">
                    {searchResults.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => addItem(c)}
                        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-gray-50"
                      >
                        <span className="font-medium">{c.name}</span>
                        {c.sku && <span className="font-mono text-xs text-muted-foreground">{c.sku}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Paste-a-list */}
            <details className="rounded-lg border bg-white p-4">
              <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-gray-700">
                <ClipboardPaste className="h-4 w-4" /> Paste a list
              </summary>
              <div className="mt-3 space-y-3">
                <textarea
                  value={pasteText}
                  onChange={(e) => { setPasteText(e.target.value); setPasteMatches(null); }}
                  rows={5}
                  placeholder={'One item per line, e.g.\n5 crackfill boxes\n2 tack coat\ntraffic cones'}
                  className="w-full rounded-md border px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <button
                  onClick={runMatch}
                  disabled={matching || !pasteText.trim()}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {matching ? 'Matching…' : 'Match to catalog'}
                </button>

                {pasteMatches && (
                  <div className="space-y-2 rounded-md border bg-gray-50 p-3">
                    {pasteMatches.map((m, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 text-sm">
                        <span className="min-w-0 flex-1 truncate">
                          <span className="text-muted-foreground">{m.qty}×</span> {m.query}
                        </span>
                        {m.catalog_item_id ? (
                          <span className="flex items-center gap-1 whitespace-nowrap">
                            <span className="font-medium text-green-700">→ {m.name}</span>
                            {m.match_kind === 'fuzzy' && (
                              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">fuzzy · confirm</span>
                            )}
                          </span>
                        ) : (
                          <span className="whitespace-nowrap rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">no match</span>
                        )}
                      </div>
                    ))}
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-xs text-muted-foreground">
                        {pasteMatches.filter((m) => m.catalog_item_id).length} matched,{' '}
                        {pasteMatches.filter((m) => !m.catalog_item_id).length} unmatched (skipped)
                      </span>
                      <button
                        onClick={acceptMatches}
                        disabled={pasteMatches.every((m) => !m.catalog_item_id)}
                        className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                      >
                        Add matched items
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </details>

            {/* The list with per-item vendor suggestions */}
            <div className="rounded-lg border bg-white">
              <div className="border-b px-4 py-3 text-sm font-semibold text-gray-700">
                Your list ({lines.length} item{lines.length === 1 ? '' : 's'})
                {loadingSuggest && <span className="ml-2 text-xs font-normal text-muted-foreground">loading suggestions…</span>}
              </div>
              {lines.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                  Add items above to see vendor suggestions.
                </div>
              ) : (
                <div className="divide-y">
                  {lines.map((line) => {
                    const it = suggestByItem.get(line.catalog_item_id);
                    const cat = catalogById.get(line.catalog_item_id);
                    const uom = (it?.uom_term_id || cat?.uom_term_id) ? (uomLabels[(it?.uom_term_id || cat?.uom_term_id)!] ?? '') : '';
                    const chosen = effectiveVendor(line);
                    return (
                      <div key={line.catalog_item_id} className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-medium">{it?.name || cat?.name || 'Item'}</div>
                            <div className="text-xs text-muted-foreground">
                              {(it?.sku || cat?.sku) && <span className="font-mono">{it?.sku || cat?.sku}</span>}
                              {it?.last_paid && (
                                <span className="ml-2">
                                  last paid {money(it.last_paid.unit_cost)}
                                  {it.last_paid.vendor_name ? ` · ${it.last_paid.vendor_name}` : ''}
                                  {it.last_paid.date ? ` · ${new Date(it.last_paid.date).toLocaleDateString()}` : ''}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={0}
                              step="any"
                              value={line.qty}
                              onChange={(e) => setQty(line.catalog_item_id, Number(e.target.value))}
                              className="w-20 rounded-md border px-2 py-1 text-right"
                            />
                            {uom && <span className="w-10 text-xs text-muted-foreground">{uom}</span>}
                            <button onClick={() => removeLine(line.catalog_item_id)} className="text-red-500 hover:text-red-700">✕</button>
                          </div>
                        </div>

                        {/* Vendor options */}
                        <div className="mt-3">
                          {!it ? (
                            <div className="text-xs text-muted-foreground">…</div>
                          ) : it.options.length === 0 ? (
                            <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                              <AlertTriangle className="h-4 w-4 shrink-0" />
                              <span>
                                No vendor on file — this goes on a placeholder draft to assign later.{' '}
                                <Link href="/inventory/vendor-items" className="font-semibold underline">Add a vendor →</Link>
                              </span>
                            </div>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {it.options.map((opt) => {
                                const active = chosen === opt.vendor_id;
                                const isRec = it.recommended_vendor_id === opt.vendor_id;
                                return (
                                  <button
                                    key={opt.vendor_id}
                                    onClick={() => setVendor(line.catalog_item_id, opt.vendor_id)}
                                    className={`flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors ${
                                      active ? 'border-primary bg-primary/10 text-primary' : 'border-gray-200 hover:bg-gray-50'
                                    }`}
                                  >
                                    <span className="font-medium">{opt.vendor_name || 'Vendor'}</span>
                                    <span className="text-xs text-muted-foreground">
                                      {opt.unit_cost != null ? money(opt.unit_cost) : 'no price'}
                                    </span>
                                    {opt.is_preferred && <span className="rounded bg-blue-100 px-1 text-xs text-blue-700">preferred</span>}
                                    {isRec && !opt.is_preferred && <span className="rounded bg-green-100 px-1 text-xs text-green-700">best</span>}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── Right: the split + act ───────────────────────────────────── */}
          <div className="space-y-4">
            <div className="sticky top-4 rounded-lg border bg-white p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                <Store className="h-4 w-4" /> Vendor split
              </div>

              {lines.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">Your split shows up here once you add items.</p>
              ) : (
                <>
                  <div className="mt-3 space-y-2">
                    {liveSplit.buckets.map(([vId, b]) => (
                      <div key={vId ?? 'none'} className="rounded-md border bg-gray-50 px-3 py-2">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">
                            {vId === null ? (
                              <span className="flex items-center gap-1 text-amber-700">
                                <AlertTriangle className="h-3.5 w-3.5" /> No vendor
                              </span>
                            ) : (
                              b.name || 'Vendor'
                            )}
                          </span>
                          <span className="text-sm font-semibold">
                            {b.unpriced && b.subtotal === 0 ? '—' : money(b.subtotal)}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          covers {b.items} item{b.items === 1 ? '' : 's'}
                          {b.unpriced && b.subtotal > 0 ? ' · some unpriced' : ''}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t pt-3">
                    <span className="text-sm text-muted-foreground">
                      {liveSplit.vendorCount} vendor{liveSplit.vendorCount === 1 ? '' : 's'}
                    </span>
                    <span className="text-lg font-bold">{money(liveSplit.total)}</span>
                  </div>

                  {/* Consolidation suggestion (from the server's recommended split). */}
                  {suggest?.split.consolidated && suggest.split.consolidated.vendor_count < suggest.split.recommended.vendor_count && (
                    <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 p-3">
                      <div className="text-xs text-blue-900">{suggest.split.consolidation_note}</div>
                      <button
                        onClick={applyConsolidated}
                        className="mt-2 w-full rounded-md border border-blue-300 bg-white px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100"
                      >
                        Use fewest vendors ({suggest.split.consolidated.vendor_count})
                      </button>
                    </div>
                  )}
                  {suggest?.split.consolidation_note && !suggest.split.consolidated && suggest.split.recommended.vendor_count > 1 && (
                    <div className="mt-3 text-xs text-muted-foreground">{suggest.split.consolidation_note}</div>
                  )}

                  {noVendorItems.length > 0 && (
                    <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      <span>{noVendorItems.length} item{noVendorItems.length === 1 ? '' : 's'} with no vendor will go on a placeholder draft to assign before approving.</span>
                    </div>
                  )}

                  <CapabilityGate capability="purchase_orders.manage">
                    <button
                      onClick={draftPOs}
                      disabled={drafting || lines.length === 0}
                      className="mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                      <ShoppingCart className="h-4 w-4" />
                      {drafting ? 'Drafting…' : `Draft ${liveSplit.buckets.length} PO${liveSplit.buckets.length === 1 ? '' : 's'}`}
                    </button>
                  </CapabilityGate>
                  <p className="mt-2 text-center text-xs text-muted-foreground">
                    Drafts only — nothing is ordered automatically.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
