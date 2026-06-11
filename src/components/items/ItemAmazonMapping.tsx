'use client';

/**
 * Per-item Amazon Business link. Shown on the item detail page (under Reference
 * Links). Lets you paste an Amazon product URL/ASIN to map THIS catalog item to
 * an Amazon SKU so it can be ordered via punchout — or remove an existing link.
 *
 * Backed by the same vendor_items mapping API the Settings page uses; this is
 * just the inline, single-item entry point.
 */
import { useState, useEffect, useCallback } from 'react';
import { Loader2, ShoppingCart, ExternalLink, Trash2, Plus } from 'lucide-react';

const API = '/api/settings/integrations/amazon-business/item-mappings';

interface Mapping {
  id: string;
  catalog_item_id: string;
  supplier_sku: string; // ASIN
  last_known_price: number | string | null;
  pack_quantity: number | null;
}

const usd = (n: number | string | null) => {
  const v = n === null || n === '' ? null : Number(n);
  return v === null || Number.isNaN(v) ? null : v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
};

export function ItemAmazonMapping({ catalogItemId }: { catalogItemId: string }) {
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(API);
      const json = await res.json();
      if (res.ok) {
        const found = (json.data || []).find((m: Mapping) => m.catalog_item_id === catalogItemId) || null;
        setMapping(found);
      }
    } catch {
      /* silent — surfaced on the action paths */
    } finally {
      setLoading(false);
    }
  }, [catalogItemId]);

  useEffect(() => {
    load();
  }, [load]);

  const link = async () => {
    if (!input.trim()) return;
    setBusy(true);
    setError('');
    setNote('');
    try {
      // 1. Resolve the URL/ASIN → ASIN + (best-effort) title/price.
      const rRes = await fetch(`${API}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
      });
      const rJson = await rRes.json();
      if (!rRes.ok) throw new Error(rJson?.error?.message || 'Could not read that Amazon link.');
      const { asin, title, price } = rJson.data;

      // 2. Map this item to that ASIN.
      const sRes = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          catalog_item_id: catalogItemId,
          asin,
          pack_quantity: 1,
          ...(typeof price === 'number' ? { last_known_price: price } : {}),
        }),
      });
      const sJson = await sRes.json();
      if (!sRes.ok) throw new Error(sJson?.error?.message || 'Could not save the Amazon link.');

      setInput('');
      setNote(title ? `Linked to “${title}”.` : 'Amazon link saved.');
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not link this item to Amazon.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!mapping) return;
    setBusy(true);
    setError('');
    setNote('');
    try {
      const res = await fetch(API, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ mapping_id: mapping.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || 'Could not remove the Amazon link.');
      setMapping(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not remove the Amazon link.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-lg border p-5">
      <div className="flex items-center gap-2 mb-1">
        <ShoppingCart className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-medium">Amazon Ordering</h3>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Link this item to an Amazon Business product so it can be reordered through punchout.
      </p>

      {error && <div className="mb-3 p-2.5 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>}
      {note && <div className="mb-3 p-2.5 bg-green-50 border border-green-200 rounded text-sm text-green-700">{note}</div>}

      {loading ? (
        <div className="h-10 rounded-md bg-muted/40 animate-pulse" />
      ) : mapping ? (
        <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 p-3">
          <div className="min-w-0">
            <div className="text-sm font-medium flex items-center gap-1.5">
              Linked to Amazon
              <a
                href={`https://www.amazon.com/dp/${mapping.supplier_sku}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-blue-600 hover:underline font-mono text-xs"
              >
                {mapping.supplier_sku} <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {usd(mapping.last_known_price) ? `Last price ${usd(mapping.last_known_price)}` : 'Price not captured yet'}
              {mapping.pack_quantity && mapping.pack_quantity > 1 ? ` · pack of ${mapping.pack_quantity}` : ''}
            </div>
          </div>
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="px-2.5 py-1.5 text-sm border rounded-md hover:bg-red-50 text-red-600 disabled:opacity-50 flex items-center gap-1.5 flex-shrink-0"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Remove
          </button>
        </div>
      ) : (
        <div className="flex items-stretch gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && link()}
            placeholder="Paste Amazon product URL or ASIN (e.g. B0XXXXXXXX)"
            className="flex-1 px-3 py-2 border rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            type="button"
            onClick={link}
            disabled={busy || !input.trim()}
            className="px-3 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 text-sm flex items-center gap-1.5 flex-shrink-0"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Link
          </button>
        </div>
      )}
    </div>
  );
}
