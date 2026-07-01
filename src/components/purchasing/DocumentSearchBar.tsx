'use client';

/**
 * Search the purchasing receipt repository from the PO list page — by invoice #,
 * receipt #, vendor order #, PO #, tracking #, vendor, sender email, file name,
 * or amount. Clicking a result opens its PO; the paperclip opens the original.
 */
import { useState, useCallback, useRef } from 'react';
import { Search, Loader2, ExternalLink, X } from 'lucide-react';

interface DocResult {
  id: string;
  purchase_order_id: string | null;
  po_number: string | null;
  doc_type: string;
  vendor_name: string | null;
  invoice_number: string | null;
  order_number: string | null;
  tracking_numbers: string[] | null;
  total: number | null;
  document_date: string | null;
  match_status: string;
  reconciled_at: string | null;
  signed_url: string | null;
}

export function DocumentSearchBar({ onOpenPo }: { onOpenPo?: (poId: string) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<DocResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(async (term: string) => {
    if (term.trim().length < 2) {
      setResults(null);
      setError('');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/inventory/purchasing/documents/search?q=${encodeURIComponent(term.trim())}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || 'Search failed');
      setResults(json.data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const onChange = (v: string) => {
    setQ(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => run(v), 300);
  };

  const clear = () => {
    setQ('');
    setResults(null);
    setError('');
  };

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Search receipts, invoices, tracking #, vendor, amount…"
          className="w-full pl-9 pr-9 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        {(q || loading) && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : (
              <button onClick={clear} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
            )}
          </div>
        )}
      </div>

      {results !== null && (
        <div className="absolute z-30 mt-1 w-full bg-white border rounded-md shadow-lg max-h-96 overflow-y-auto">
          {error && <div className="p-3 text-sm text-red-600">{error}</div>}
          {!error && results.length === 0 && <div className="p-3 text-sm text-muted-foreground">No matching documents.</div>}
          {results.map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between gap-3 p-3 border-b last:border-b-0 hover:bg-muted/40 cursor-pointer"
              onClick={() => d.purchase_order_id && onOpenPo?.(d.purchase_order_id)}
            >
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">
                  {prettify(d.doc_type)}
                  {d.po_number && <span className="ml-1.5 font-mono text-xs text-muted-foreground">{d.po_number}</span>}
                  {d.reconciled_at && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full border bg-green-100 text-green-800 border-green-300">Reconciled</span>}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {[
                    d.vendor_name,
                    d.invoice_number && `Inv #${d.invoice_number}`,
                    d.order_number && `Order ${d.order_number}`,
                    d.total != null && `$${Number(d.total).toFixed(2)}`,
                    d.tracking_numbers?.length ? `Track ${d.tracking_numbers[0]}` : null,
                    d.document_date,
                  ].filter(Boolean).join(' · ')}
                </div>
              </div>
              {d.signed_url && (
                <a
                  href={d.signed_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-primary shrink-0"
                  title="Open original"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function prettify(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
