'use client';

/**
 * "Paste an Amazon link" — inline on a PO line (sprint 2026-08-14 item 05).
 *
 * The buyer is already building the order. If a line has no Amazon mapping yet,
 * they paste the product URL right here: we pull the ASIN (+ title/price/image
 * when Amazon lets us), show a confirm card, and on confirm save the mapping
 * AND fill the line. No detour to a settings page.
 *
 * Three shapes of confirm, depending on what the line has:
 *   • line already has a catalog item  → save the mapping to it, fill the price
 *   • line has no catalog item         → search + pick one to map to
 *   • line has no catalog item, one-off → fill description/cost, save NOTHING
 *                                          (deliberately no phantom catalog rows)
 *
 * Degradation is first-class: a garbage URL, a blocked page read, or a missing
 * price all come back as a plain sentence the buyer can act on — never a
 * red error banner, never a dead end.
 */

import { useMemo, useState } from 'react';
import { Loader2, Link2, Package, Check, X, Search, ExternalLink } from 'lucide-react';

export interface AmazonResolution {
  ok: boolean;
  asin: string | null;
  title: string | null;
  price: number | null;
  image_url: string | null;
  source_url: string | null;
  input_url: string;
  source: 'parsed' | 'fetched' | 'degraded';
  message: string;
  existing_mapping: {
    catalog_item_id: string;
    catalog_item_label: string;
    unit_cost: number | null;
  } | null;
  amazon_connected: boolean;
}

export interface AmazonApplyPayload {
  /** Non-null when the ASIN was mapped to a catalog item. */
  catalogItemId: string | null;
  /** Product title — used as the description on a one-off line. */
  description: string;
  /** Parsed price, when Amazon gave one up. */
  unitCost: number | null;
  asin: string;
  /** True when a mapping row was persisted (false for one-off lines). */
  mapped: boolean;
}

interface CatalogOption {
  id: string;
  name: string;
  sku: string;
}

interface Props {
  /** Catalog item already chosen on this line, if any. */
  catalogItemId: string | null;
  /** Label for that item, for the confirm copy. */
  catalogItemLabel?: string | null;
  /** Full catalog, for the "map to an existing item" search. */
  catalogItems: CatalogOption[];
  onApply: (payload: AmazonApplyPayload) => void;
  onClose: () => void;
}

export function AmazonLinkPaste({
  catalogItemId,
  catalogItemLabel,
  catalogItems,
  onApply,
  onClose,
}: Props) {
  const [url, setUrl] = useState('');
  const [resolving, setResolving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<AmazonResolution | null>(null);
  const [error, setError] = useState<string | null>(null);

  // "Map to an existing catalog item" — only used when the line has none yet.
  const [pickSearch, setPickSearch] = useState('');
  const [pickedItemId, setPickedItemId] = useState<string | null>(null);

  const targetItemId = catalogItemId || pickedItemId;

  const searchResults = useMemo(() => {
    const q = pickSearch.trim().toLowerCase();
    if (!q) return [];
    return catalogItems
      .filter((i) => i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q))
      .slice(0, 8);
  }, [pickSearch, catalogItems]);

  const pickedItem = catalogItems.find((i) => i.id === pickedItemId) || null;

  const resolve = async () => {
    if (!url.trim() || resolving) return;
    setResolving(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/inventory/amazon/resolve-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ url: url.trim() }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error?.message || json?.error || `Couldn’t read that link (${res.status}).`);
        return;
      }
      setResult(json as AmazonResolution);
      // Amazon told us this ASIN is already mapped — preselect that item so
      // confirming reuses the mapping instead of quietly making a second one.
      const existing = (json as AmazonResolution).existing_mapping;
      if (!catalogItemId && existing) setPickedItemId(existing.catalog_item_id);
    } catch (err: any) {
      setError(err?.message || 'Network error reading that link.');
    } finally {
      setResolving(false);
    }
  };

  /** Save the mapping (when we have a catalog item) and fill the line. */
  const confirm = async (mode: 'map' | 'one-off') => {
    if (!result?.ok || !result.asin || saving) return;
    setError(null);

    if (mode === 'one-off') {
      onApply({
        catalogItemId: null,
        description: result.title || `Amazon item ${result.asin}`,
        unitCost: result.price,
        asin: result.asin,
        mapped: false,
      });
      onClose();
      return;
    }

    if (!targetItemId) {
      setError('Pick the catalog item this Amazon product is, or add it as a one-off line.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/inventory/amazon/map-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        credentials: 'include',
        body: JSON.stringify({
          catalog_item_id: targetItemId,
          asin: result.asin,
          title: result.title,
          price: result.price,
          image_url: result.image_url,
          source_url: result.source_url,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error?.message || json?.error || `Couldn’t save the mapping (${res.status}).`);
        return;
      }
      onApply({
        catalogItemId: targetItemId,
        description: result.title || `Amazon item ${result.asin}`,
        unitCost: result.price,
        asin: result.asin,
        mapped: true,
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Network error saving the mapping.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-orange-200 bg-orange-50/60 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-orange-900">
          <Link2 className="h-4 w-4" />
          Paste the Amazon product link
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-orange-700 hover:text-orange-900"
          aria-label="Close Amazon link paste"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              resolve();
            }
          }}
          placeholder="https://www.amazon.com/dp/B0… (or an a.co short link)"
          className="flex-1 rounded-md border border-orange-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
        />
        <button
          type="button"
          onClick={resolve}
          disabled={!url.trim() || resolving}
          className="inline-flex items-center gap-1.5 rounded-md bg-orange-600 px-3 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
        >
          {resolving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {resolving ? 'Reading…' : 'Look up'}
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {/* Degraded: no ASIN. Say what to do, don't just fail. */}
      {result && !result.ok && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {result.message}
        </div>
      )}

      {/* Confirm card */}
      {result?.ok && result.asin && (
        <div className="space-y-3 rounded-md border border-orange-200 bg-white p-3">
          <div className="flex gap-3">
            {result.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={result.image_url}
                alt={result.title || result.asin}
                className="h-16 w-16 shrink-0 rounded border border-gray-200 object-contain"
              />
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded border border-dashed border-gray-300 bg-gray-50">
                <Package className="h-6 w-6 text-gray-300" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-gray-900">
                {result.title || <span className="text-gray-500">No title — Amazon didn’t share one</span>}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-gray-700">ASIN {result.asin}</span>
                <span className={result.price != null ? 'font-medium text-gray-900' : 'text-gray-500'}>
                  {result.price != null ? `$${result.price.toFixed(2)}` : 'No price found'}
                </span>
                {result.source_url && (
                  <a
                    href={result.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                  >
                    View on Amazon <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              <p className="mt-1 text-xs text-gray-500">{result.message}</p>
            </div>
          </div>

          {result.existing_mapping && (
            <div className="rounded border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs text-blue-800">
              Already mapped to <strong>{result.existing_mapping.catalog_item_label}</strong> — confirming
              refreshes that mapping instead of creating a second one.
            </div>
          )}

          {!result.amazon_connected && (
            <div className="rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
              Amazon Business isn’t connected for this tenant, so the mapping can’t be saved — you can still
              add this as a one-off line.
            </div>
          )}

          {/* Which catalog item does this ASIN belong to? */}
          {catalogItemId ? (
            <div className="text-xs text-gray-600">
              Maps to <strong>{catalogItemLabel || 'the item on this line'}</strong>.
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-xs font-medium text-gray-700">Map it to a catalog item (optional)</div>
              {pickedItem ? (
                <div className="flex items-center justify-between rounded border border-green-200 bg-green-50 px-2.5 py-1.5 text-xs text-green-800">
                  <span>
                    <Check className="mr-1 inline h-3 w-3" />
                    {pickedItem.name} ({pickedItem.sku})
                  </span>
                  <button
                    type="button"
                    onClick={() => { setPickedItemId(null); setPickSearch(''); }}
                    className="font-medium text-green-700 underline hover:text-green-900"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    value={pickSearch}
                    onChange={(e) => setPickSearch(e.target.value)}
                    placeholder="Search the catalog by name or SKU…"
                    className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                  {searchResults.length > 0 && (
                    <div className="max-h-40 overflow-y-auto rounded border border-gray-200">
                      {searchResults.map((i) => (
                        <button
                          key={i.id}
                          type="button"
                          onClick={() => setPickedItemId(i.id)}
                          className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-xs hover:bg-orange-50"
                        >
                          <span className="truncate text-gray-900">{i.name}</span>
                          <span className="ml-2 shrink-0 font-mono text-gray-500">{i.sku}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {pickSearch.trim() && searchResults.length === 0 && (
                    <div className="text-xs text-gray-500">
                      Nothing matches “{pickSearch.trim()}”. Add it as a one-off line instead — no catalog
                      item gets invented.
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() => confirm('map')}
              disabled={saving || !targetItemId || !result.amazon_connected}
              className="inline-flex items-center gap-1.5 rounded-md bg-orange-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
              title={
                !result.amazon_connected
                  ? 'Amazon Business isn’t connected for this tenant'
                  : !targetItemId
                    ? 'Pick a catalog item first'
                    : undefined
              }
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Save mapping & fill line
            </button>
            <button
              type="button"
              onClick={() => confirm('one-off')}
              disabled={saving}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Keep as a one-off line
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
