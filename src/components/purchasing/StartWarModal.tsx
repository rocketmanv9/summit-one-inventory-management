'use client';

/**
 * StartWarModal — start a price war the way you'd picture it: pick any two (or
 * more) vendors, add any items (a catalog item OR an ad-hoc line you type), and
 * we draft ONE email per vendor covering everything. Then you eyeball the draft
 * and hit send — one email to each vendor, and they bid against each other.
 *
 * Two steps:
 *   1. PICK   — vendors (any active vendor) + items (catalog search or ad-hoc).
 *   2. REVIEW — the one drafted email per vendor, and a single "Send" button.
 *
 * On start it POSTs /price-wars/requests (one parent + a round per line), then
 * /requests/[id]/draft-rfq. Sending is the explicit request-level /send-invites.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Swords, Loader2, Search, Crown, Check, X, Plus, AlertTriangle, Sparkles, Send, Mail, ArrowLeft,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { apiWrite } from '@/lib/api-client';
import { InventoryRPC } from '@/lib/rpc/inventory';

interface VendorPrice { vendor_id: string; vendor_name: string; contact_email: string | null; best_unit_cost: number; is_low: boolean; }
interface Candidate { catalog_item_id: string; name: string; sku: string | null; vendor_count: number; qty_last_12m: number; vendors: VendorPrice[]; open_round_id: string | null; }

interface VendorRow { id: string; name: string; contact_email: string | null; po_email: string | null; is_active?: boolean; active?: boolean; }
interface CatalogRow { id: string; name: string; sku: string | null; }
interface AdhocLine { key: string; label: string; qty: string; }
interface DraftResult { vendor_id: string; vendor_name: string; subject: string; body: string; contact_email: string | null; ai: boolean; }

async function readJson(res: Response) {
  const text = await res.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { error: text }; }
  if (!res.ok) return { ok: false as const, message: json?.error?.message || json?.error || json?.message || `Request failed (${res.status})`, json };
  return { ok: true as const, json };
}

export function StartWarModal({
  open, candidates, onClose, onStarted, initialPicks, initialVendorIds, title, description,
}: {
  open: boolean;
  candidates: Candidate[];
  onClose: () => void;
  onStarted: (anchorRoundId: string | null, requestId: string) => void;
  initialPicks?: Record<string, number>;
  initialVendorIds?: string[];
  title?: string;
  description?: string;
}) {
  const [step, setStep] = useState<'pick' | 'review'>('pick');
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [items, setItems] = useState<CatalogRow[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Record<string, string>>({}); // catalog item id → qty
  const [adhoc, setAdhoc] = useState<AdhocLine[]>([]);
  const [adhocInput, setAdhocInput] = useState('');
  const [vendorSel, setVendorSel] = useState<Record<string, boolean>>({});
  const [vendorQuery, setVendorQuery] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftResult[]>([]);
  const [sendNotice, setSendNotice] = useState('');

  const seededForOpen = useRef(false);

  // Reset everything each time the modal closes.
  useEffect(() => {
    if (!open) {
      seededForOpen.current = false;
      setStep('pick'); setQuery(''); setPicked({}); setAdhoc([]); setAdhocInput('');
      setVendorSel({}); setVendorQuery(''); setError(''); setRequestId(null); setAnchor(null);
      setDrafts([]); setSendNotice(''); setBusy(false);
    }
  }, [open]);

  // Load all active vendors + catalog items when the modal opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoadingData(true);
      try {
        const [vRes, catItems] = await Promise.all([
          fetch('/api/inventory/vendors?active_only=true', { credentials: 'include' }).then(readJson),
          InventoryRPC.getCatalogItems({ active: true }).catch(() => []),
        ]);
        if (cancelled) return;
        if (vRes.ok) setVendors(((vRes.json.data ?? []) as VendorRow[]).filter((v) => v.is_active ?? v.active ?? true));
        setItems(((catItems ?? []) as any[]).map((i) => ({ id: i.id, name: i.name, sku: i.sku ?? null })));
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  // Seed picks/vendors once per open (PO-create handoff).
  useEffect(() => {
    if (!open || seededForOpen.current) return;
    if (items.length === 0 && initialPicks && Object.keys(initialPicks).length > 0) return;
    seededForOpen.current = true;
    if (initialPicks && Object.keys(initialPicks).length > 0) {
      const ids = new Set(items.map((i) => i.id));
      const seeded: Record<string, string> = {};
      for (const [id, qty] of Object.entries(initialPicks)) {
        if (!ids.has(id)) continue;
        seeded[id] = qty > 0 ? String(Math.round(qty)) : '';
      }
      if (Object.keys(seeded).length > 0) setPicked(seeded);
    }
    if (initialVendorIds && initialVendorIds.length > 0) {
      const sel: Record<string, boolean> = {};
      for (const id of initialVendorIds) sel[id] = true;
      setVendorSel(sel);
    }
  }, [open, items, initialPicks, initialVendorIds]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = items.filter((i) => picked[i.id] === undefined);
    if (!q) return base.slice(0, 50);
    return base.filter((i) => i.name.toLowerCase().includes(q) || (i.sku ?? '').toLowerCase().includes(q)).slice(0, 50);
  }, [items, query, picked]);

  const pickedItems = useMemo(() => items.filter((i) => picked[i.id] !== undefined), [items, picked]);
  const filteredVendors = useMemo(() => {
    const q = vendorQuery.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter((v) => v.name.toLowerCase().includes(q));
  }, [vendors, vendorQuery]);

  const selectedVendorIds = useMemo(() => vendors.filter((v) => vendorSel[v.id]).map((v) => v.id), [vendors, vendorSel]);
  const lineCount = pickedItems.length + adhoc.length;
  const canStart = lineCount >= 1 && selectedVendorIds.length >= 2 && !busy;

  const priceHint = (itemId: string, vendorId: string): number | null => {
    const c = candidates.find((x) => x.catalog_item_id === itemId);
    return c?.vendors.find((v) => v.vendor_id === vendorId)?.best_unit_cost ?? null;
  };

  const toggleItem = (i: CatalogRow) => {
    setPicked((prev) => {
      const next = { ...prev };
      if (next[i.id] !== undefined) delete next[i.id];
      else {
        const c = candidates.find((x) => x.catalog_item_id === i.id);
        next[i.id] = c && c.qty_last_12m > 0 ? String(Math.round(c.qty_last_12m)) : '';
      }
      return next;
    });
  };

  const addAdhoc = () => {
    const label = adhocInput.trim();
    if (!label) return;
    setAdhoc((prev) => [...prev, { key: `adhoc-${prev.length}-${label.slice(0, 8)}`, label, qty: '' }]);
    setAdhocInput('');
  };

  const start = async () => {
    if (!canStart) return;
    setBusy(true); setError('');
    try {
      const lines = [
        ...pickedItems.map((i) => {
          const raw = picked[i.id]; const n = Number(raw);
          return { catalog_item_id: i.id, ...(raw !== '' && Number.isFinite(n) && n > 0 ? { target_qty: n } : {}) };
        }),
        ...adhoc.map((a) => {
          const n = Number(a.qty);
          return { item_label: a.label, ...(a.qty !== '' && Number.isFinite(n) && n > 0 ? { target_qty: n } : {}) };
        }),
      ];
      const res = await apiWrite('/api/inventory/price-wars/requests', { method: 'POST', body: { vendor_ids: selectedVendorIds, lines } });
      const result = await readJson(res);
      if (!result.ok) { setError(result.message); return; }
      const rid: string = result.json.data?.request_id;
      setRequestId(rid);
      setAnchor(result.json.data?.anchor_round_id ?? null);

      // Draft one email per vendor covering every line.
      const dRes = await apiWrite(`/api/inventory/price-wars/requests/${rid}/draft-rfq`, { method: 'POST', body: {} });
      const d = await readJson(dRes);
      if (d.ok) setDrafts((d.json.data?.drafts ?? []) as DraftResult[]);
      else setError(`War opened, but drafting the emails failed: ${d.message}`);
      setStep('review');
    } catch (e: any) {
      setError(e?.message || 'Could not start the price war.');
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!requestId) return;
    setBusy(true); setError(''); setSendNotice('');
    try {
      const res = await apiWrite(`/api/inventory/price-wars/requests/${requestId}/send-invites`, { method: 'POST', body: {} });
      const result = await readJson(res);
      if (!result.ok) { setError(result.message); return; }
      setSendNotice(result.json.data?.message || 'Invites sent.');
    } catch (e: any) {
      setError(e?.message || 'Sending failed.');
    } finally {
      setBusy(false);
    }
  };

  const finish = () => { if (requestId) onStarted(anchor, requestId); };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl gap-0 overflow-hidden p-0">
        <div className="border-b bg-background px-6 pb-4 pt-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Swords className="h-5 w-5 text-primary" /> {title ?? 'Start a price war'}
            </DialogTitle>
            <DialogDescription>
              {step === 'pick'
                ? (description ?? 'Pick your vendors, add the items you want priced (catalog or type your own), and we draft one email per vendor. You review and send.')
                : 'Here is the one email each vendor gets. Send them, and they bid against each other.'}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-5">
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
            </div>
          )}

          {step === 'pick' ? (
            <>
              {/* ── Step 1: items ── */}
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">1 · Items to price</h3>

                {(pickedItems.length > 0 || adhoc.length > 0) && (
                  <div className="mb-3 space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-2.5">
                    {pickedItems.map((i) => (
                      <div key={i.id} className="flex items-center gap-2">
                        <div className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">
                          {i.name}{i.sku && <span className="ml-1.5 font-mono text-[11px] text-gray-400">{i.sku}</span>}
                        </div>
                        <label className="flex items-center gap-1 text-xs text-gray-500">qty
                          <input type="number" min="1" step="1" value={picked[i.id]} placeholder="auto"
                            onChange={(e) => setPicked((p) => ({ ...p, [i.id]: e.target.value }))}
                            className="w-24 rounded border border-gray-300 px-2 py-1 text-sm" />
                        </label>
                        <button type="button" onClick={() => toggleItem(i)} className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-700"><X className="h-4 w-4" /></button>
                      </div>
                    ))}
                    {adhoc.map((a, idx) => (
                      <div key={a.key} className="flex items-center gap-2">
                        <div className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">
                          {a.label}<span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-px text-[10px] font-medium text-amber-700">custom</span>
                        </div>
                        <label className="flex items-center gap-1 text-xs text-gray-500">qty
                          <input type="number" min="1" step="1" value={a.qty} placeholder="auto"
                            onChange={(e) => setAdhoc((p) => p.map((x, i2) => i2 === idx ? { ...x, qty: e.target.value } : x))}
                            className="w-24 rounded border border-gray-300 px-2 py-1 text-sm" />
                        </label>
                        <button type="button" onClick={() => setAdhoc((p) => p.filter((_, i2) => i2 !== idx))} className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-700"><X className="h-4 w-4" /></button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="relative mb-2">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search catalog items…"
                    className="h-9 w-full rounded-lg border border-gray-300 pl-9 pr-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30" />
                </div>

                {loadingData ? (
                  <p className="p-3 text-center text-xs text-gray-400"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> Loading items…</p>
                ) : filteredItems.length === 0 ? (
                  <p className="rounded-md border border-dashed border-gray-300 p-3 text-center text-xs text-gray-500">{query ? 'No matches — add it as a custom line below.' : 'Start typing to find items.'}</p>
                ) : (
                  <ul className="max-h-40 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200">
                    {filteredItems.map((i) => (
                      <li key={i.id}>
                        <button type="button" onClick={() => toggleItem(i)} className="flex w-full items-center justify-between gap-2 bg-white px-3 py-2 text-left text-sm hover:bg-primary/5">
                          <span className="min-w-0 truncate"><span className="font-medium text-gray-900">{i.name}</span>{i.sku && <span className="ml-1.5 text-[11px] text-gray-400">{i.sku}</span>}</span>
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary"><Plus className="h-3.5 w-3.5" /> add</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {/* Ad-hoc line */}
                <div className="mt-2 flex items-center gap-2">
                  <input value={adhocInput} onChange={(e) => setAdhocInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAdhoc(); } }}
                    placeholder="…or type something not in the catalog (e.g. skid-steer mulcher head)"
                    className="h-9 flex-1 rounded-lg border border-gray-300 px-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30" />
                  <button type="button" onClick={addAdhoc} disabled={!adhocInput.trim()} className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"><Plus className="h-4 w-4" /> Custom line</button>
                </div>
              </section>

              {/* ── Step 2: vendors ── */}
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">2 · Vendors in the ring</h3>
                <div className="relative mb-2">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input value={vendorQuery} onChange={(e) => setVendorQuery(e.target.value)} placeholder="Search vendors…"
                    className="h-9 w-full rounded-lg border border-gray-300 pl-9 pr-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30" />
                </div>
                {loadingData ? (
                  <p className="p-3 text-center text-xs text-gray-400"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> Loading vendors…</p>
                ) : (
                  <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
                    {filteredVendors.map((v) => {
                      const on = !!vendorSel[v.id];
                      const hint = pickedItems.map((i) => priceHint(i.id, v.id)).find((n) => n !== null) ?? null;
                      const noEmail = !(v.contact_email || v.po_email);
                      return (
                        <button key={v.id} type="button" onClick={() => setVendorSel((s) => ({ ...s, [v.id]: !on }))}
                          title={noEmail ? 'No email on file — you can still add them, but you can only copy the draft' : (v.contact_email || v.po_email || '')}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition ${on ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}>
                          {on ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                          {v.name}
                          {hint !== null && <span className="font-mono text-[11px] text-gray-400">${hint.toFixed(2)}</span>}
                          {noEmail && <Mail className="h-3 w-3 text-amber-500" />}
                        </button>
                      );
                    })}
                  </div>
                )}
                {selectedVendorIds.length === 1 && <p className="mt-2 text-xs text-amber-600">Pick at least two vendors — one vendor isn&apos;t a war.</p>}
              </section>
            </>
          ) : (
            /* ── Review + send ── */
            <section className="space-y-4">
              {sendNotice && <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{sendNotice}</div>}
              {drafts.length === 0 ? (
                <p className="rounded-md border border-dashed border-gray-300 p-4 text-center text-sm text-gray-500">No drafts to show — you can still open the arena and draft per vendor.</p>
              ) : drafts.map((d) => (
                <div key={d.vendor_id} className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="font-semibold text-gray-900">{d.vendor_name}</div>
                    <div className="text-xs text-gray-500">{d.contact_email ?? <span className="text-amber-600">no email — copy it</span>}</div>
                  </div>
                  <div className="text-sm font-medium text-gray-800">{d.subject}</div>
                  <textarea readOnly value={d.body} rows={6} className="mt-2 w-full resize-y rounded border border-gray-200 bg-gray-50 p-2 font-mono text-xs text-gray-800" />
                </div>
              ))}
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center gap-3 border-t bg-background px-6 py-4">
          {step === 'pick' ? (
            <>
              <div className="text-xs text-gray-500">{lineCount} item{lineCount === 1 ? '' : 's'} · {selectedVendorIds.length} vendor{selectedVendorIds.length === 1 ? '' : 's'}</div>
              <div className="ml-auto flex items-center gap-2">
                <button type="button" onClick={onClose} className="rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
                <button type="button" onClick={start} disabled={!canStart}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Draft the emails
                </button>
              </div>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setStep('pick')} className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"><ArrowLeft className="h-4 w-4" /> Back</button>
              <div className="ml-auto flex items-center gap-2">
                <button type="button" onClick={finish} className="rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">{sendNotice ? 'Open the arena' : 'Skip — I’ll send later'}</button>
                <button type="button" onClick={send} disabled={busy || !!sendNotice}
                  className="inline-flex items-center gap-2 rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send to {drafts.length || selectedVendorIds.length} vendor{(drafts.length || selectedVendorIds.length) === 1 ? '' : 's'}
                </button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
