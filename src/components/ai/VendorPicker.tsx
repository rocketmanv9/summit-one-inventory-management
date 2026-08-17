'use client';

/**
 * VendorPicker — the "Change / find vendor" affordance for the Draft-PO card
 * (sprint item 04). Fills the seam item 03 left as a disabled stub.
 *
 * Three tiers, driven by item 01's recommendation output (fetched on demand from
 * GET /api/ai/recommend-vendor for the draft's first line):
 *
 *   1. Your vendors   — the tenant's own vendors (SupplyChainRPC.getVendors).
 *                        Picking one just swaps the card's vendor_id (no writes).
 *   2. From the catalog — GV vendor_catalog candidates. "Add & use" adopts the
 *                        candidate into supply_chain.vendors (POST /api/gv/vendors/adopt)
 *                        — a single low-risk tap — then re-previews the draft.
 *   3. Search the web  — POST /api/ai/vendor-discover returns real candidates.
 *                        "Add & use" runs the dup-guard + creates a brand-new
 *                        vendor via createVendorFromDraft (the guarded
 *                        POST /api/inventory/vendors path). A STRONG duplicate
 *                        (≥72) blocks and offers "use the existing one" OR an
 *                        explicit "create anyway" (force). Never a silent dupe.
 *
 * All three end the same way: onPick({ vendor_id, name, code }) tells the card to
 * set its vendor and re-run the preview. This component performs the vendor
 * adopt/create writes; the card owns the re-preview.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Check,
  Globe,
  Loader2,
  Plus,
  Search,
  Store,
  X,
} from 'lucide-react';
import { SupplyChainRPC } from '@/lib/rpc/supply-chain';
import {
  createVendorFromDraft,
  type VendorDraft,
  type VendorMatchResult,
} from '@/lib/vendor-draft';

// ── Public contract ─────────────────────────────────────────────────────

export interface PickedVendor {
  vendor_id: string;
  name: string;
  code: string | null;
}

interface VendorPickerProps {
  /** Free-text item ref (name or catalog_item_id) that anchors the catalog /
   *  web tiers — usually the draft's first line. */
  itemRef: string | null;
  /** Optional location for a location-aware web-search suggestion. */
  locationId?: string | null;
  /** Currently selected tenant vendor id, to mark it in the list. */
  currentVendorId: string | null;
  /** Called after any tier resolves to a real tenant vendor. */
  onPick: (vendor: PickedVendor) => void;
  onClose: () => void;
}

// ── Local shapes ─────────────────────────────────────────────────────────

interface TenantVendorRow {
  id: string;
  name: string;
  code: string | null;
}

interface CatalogCandidate {
  catalog_vendor_id: string;
  name: string;
  city: string | null;
  state: string | null;
  industry_tags: string[];
}

interface WebCandidate {
  name: string;
  code?: string;
  category?: string;
  street1?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  email?: string;
  website?: string;
}

type Tier = 'tenant' | 'catalog' | 'web';

// A row-scoped busy/error/dup-gate state so one candidate's flow doesn't block
// the others.
interface RowState {
  busy?: boolean;
  error?: string | null;
  /** STRONG dup match returned by the create guard — awaiting the user's call. */
  gate?: { matches: VendorMatchResult[] } | null;
}

const STRONG_MATCH_THRESHOLD = 72;

export function VendorPicker({
  itemRef,
  locationId,
  currentVendorId,
  onPick,
  onClose,
}: VendorPickerProps) {
  const [tier, setTier] = useState<Tier>('tenant');

  // Tenant vendors.
  const [tenantVendors, setTenantVendors] = useState<TenantVendorRow[] | null>(null);
  const [tenantFilter, setTenantFilter] = useState('');

  // Catalog candidates (from item 01's recommendation).
  const [catalog, setCatalog] = useState<CatalogCandidate[] | null>(null);
  const [webAvailable, setWebAvailable] = useState(false);
  const [suggestedQuery, setSuggestedQuery] = useState<string>('');
  const [recLoading, setRecLoading] = useState(false);

  // Web search.
  const [webQuery, setWebQuery] = useState('');
  const [webResults, setWebResults] = useState<WebCandidate[] | null>(null);
  const [webSearching, setWebSearching] = useState(false);

  // Per-candidate row state, keyed by a stable id.
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});
  const patchRow = (key: string, patch: RowState) =>
    setRowStates((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));

  // ── Load tenant vendors once ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    SupplyChainRPC.getVendors()
      .then((rows) => {
        if (cancelled) return;
        setTenantVendors(
          (rows || []).map((v: any) => ({ id: v.id, name: v.name, code: v.code ?? null })),
        );
      })
      .catch(() => {
        if (!cancelled) setTenantVendors([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Load item-01 recommendation (catalog tier + web availability) ───────
  useEffect(() => {
    if (!itemRef) {
      setCatalog([]);
      return;
    }
    let cancelled = false;
    setRecLoading(true);
    const params = new URLSearchParams({ item_ref: itemRef });
    if (locationId) params.set('location_id', locationId);
    fetch(`/api/ai/recommend-vendor?${params.toString()}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        const rec = json?.data;
        const opts = Array.isArray(rec?.options) ? rec.options : [];
        // Catalog options carry catalog_vendor_id; tenant options don't.
        const cat: CatalogCandidate[] = opts
          .filter((o: any) => o?.source === 'catalog' && o?.catalog_vendor_id)
          .map((o: any) => ({
            catalog_vendor_id: o.catalog_vendor_id,
            name: o.name,
            city: o.city ?? null,
            state: o.state ?? null,
            industry_tags: Array.isArray(o.industry_tags) ? o.industry_tags : [],
          }));
        setCatalog(cat);
        setWebAvailable(!!rec?.web_search_available || cat.length === 0);
        const sq = typeof rec?.suggested_query === 'string' ? rec.suggested_query : '';
        setSuggestedQuery(sq);
        if (sq) setWebQuery((cur) => cur || sq);
      })
      .catch(() => {
        if (!cancelled) {
          setCatalog([]);
          setWebAvailable(true);
        }
      })
      .finally(() => {
        if (!cancelled) setRecLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [itemRef, locationId]);

  const filteredTenant = useMemo(() => {
    const list = tenantVendors || [];
    const q = tenantFilter.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        (v.code || '').toLowerCase().includes(q),
    );
  }, [tenantVendors, tenantFilter]);

  // ── Tier 1: pick an existing tenant vendor ──────────────────────────────
  const pickTenant = (v: TenantVendorRow) => {
    onPick({ vendor_id: v.id, name: v.name, code: v.code });
  };

  // ── Tier 2: adopt a catalog candidate, then use it ──────────────────────
  const adoptCatalog = async (c: CatalogCandidate) => {
    const key = `cat:${c.catalog_vendor_id}`;
    patchRow(key, { busy: true, error: null });
    try {
      const res = await fetch('/api/gv/vendors/adopt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': crypto.randomUUID(),
        },
        credentials: 'include',
        body: JSON.stringify({ catalogVendorIds: [c.catalog_vendor_id] }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        patchRow(key, {
          busy: false,
          error: json?.error?.message || json?.message || 'Could not add this vendor.',
        });
        return;
      }
      // The route returns { data: AdoptResult } where AdoptResult is
      // { message, adopted: Vendor[], skipped }.
      const payload = json?.data ?? json;
      const adopted = Array.isArray(payload?.adopted)
        ? payload.adopted[0]
        : Array.isArray(payload)
          ? payload[0]
          : payload?.adopted ?? payload;
      const vendorId: string | null =
        adopted?.id || adopted?.vendor_id || adopted?.tenant_vendor_id || null;
      if (!vendorId) {
        patchRow(key, { busy: false, error: 'Adopted, but no vendor id came back — try picking it from Your vendors.' });
        return;
      }
      patchRow(key, { busy: false, error: null });
      onPick({ vendor_id: vendorId, name: adopted?.name || c.name, code: adopted?.code ?? null });
    } catch (err: any) {
      patchRow(key, { busy: false, error: err?.message || 'Network error adding the vendor.' });
    }
  };

  // ── Tier 3: run the web search ──────────────────────────────────────────
  const runWebSearch = async () => {
    const q = webQuery.trim();
    if (!q || webSearching) return;
    setWebSearching(true);
    setWebResults(null);
    try {
      const res = await fetch('/api/ai/vendor-discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ query: q }),
      });
      const json = await res.json().catch(() => ({}));
      setWebResults(Array.isArray(json?.results) ? json.results : []);
    } catch {
      setWebResults([]);
    } finally {
      setWebSearching(false);
    }
  };

  // ── Tier 3: create a brand-new vendor from a web candidate ──────────────
  //   force=false runs the dup-guard; a STRONG match parks a gate the user must
  //   resolve (use existing OR create anyway). force=true bypasses the guard.
  const createFromWeb = async (c: WebCandidate, key: string, force: boolean) => {
    patchRow(key, { busy: true, error: null, gate: null });
    const draft: VendorDraft = {
      name: c.name,
      code: c.code,
      website: c.website,
      address:
        c.street1 || c.city || c.state || c.zip
          ? { street1: c.street1, city: c.city, state: c.state, zip: c.zip }
          : undefined,
      contact:
        c.phone || c.email
          ? { phone: c.phone, email: c.email }
          : undefined,
      force: force || undefined,
    };
    try {
      const created = await createVendorFromDraft(draft);
      patchRow(key, { busy: false, error: null, gate: null });
      onPick({ vendor_id: created.id, name: created.name, code: c.code ?? null });
    } catch (err: any) {
      // The guarded route throws AppError.conflict with { matches } on a STRONG
      // match. AppError carries a `.details` object; also handle a plain fetch
      // error whose message is the server body.
      const details = err?.details ?? err?.data ?? null;
      const matches: VendorMatchResult[] = Array.isArray(details?.matches)
        ? details.matches
        : Array.isArray(err?.matches)
          ? err.matches
          : [];
      const strong = matches.filter((m) => m.confidence >= STRONG_MATCH_THRESHOLD);
      if (strong.length > 0) {
        patchRow(key, { busy: false, gate: { matches: strong }, error: null });
        return;
      }
      patchRow(key, {
        busy: false,
        error: err?.message || 'Could not add this vendor.',
      });
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Change or find a vendor
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
          aria-label="Close vendor picker"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Tier tabs */}
      <div className="mb-3 flex gap-1 rounded-md bg-gray-100 p-0.5 text-xs">
        <TabButton active={tier === 'tenant'} onClick={() => setTier('tenant')} icon={<Store className="h-3.5 w-3.5" />}>
          Your vendors
        </TabButton>
        <TabButton active={tier === 'catalog'} onClick={() => setTier('catalog')} icon={<Building2 className="h-3.5 w-3.5" />}>
          From catalog
          {catalog && catalog.length > 0 && (
            <span className="ml-1 rounded-full bg-teal-100 px-1.5 text-[10px] font-semibold text-teal-700">
              {catalog.length}
            </span>
          )}
        </TabButton>
        <TabButton active={tier === 'web'} onClick={() => setTier('web')} icon={<Globe className="h-3.5 w-3.5" />}>
          Search web
        </TabButton>
      </div>

      {/* ── Tier 1: Your vendors ── */}
      {tier === 'tenant' && (
        <div>
          <input
            type="text"
            value={tenantFilter}
            onChange={(e) => setTenantFilter(e.target.value)}
            placeholder="Filter your vendors…"
            className="mb-2 w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-300"
          />
          {tenantVendors == null ? (
            <RowSpinner label="Loading your vendors…" />
          ) : filteredTenant.length === 0 ? (
            <p className="py-3 text-center text-xs text-gray-500">
              {tenantVendors.length === 0 ? 'No vendors on file yet.' : 'No matches.'}
            </p>
          ) : (
            <ul className="max-h-56 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200 bg-white">
              {filteredTenant.map((v) => {
                const isCurrent = v.id === currentVendorId;
                return (
                  <li key={v.id}>
                    <button
                      type="button"
                      onClick={() => pickTenant(v)}
                      disabled={isCurrent}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-teal-50 disabled:cursor-default disabled:bg-emerald-50"
                    >
                      <span className="min-w-0 truncate">
                        <span className="font-medium text-gray-900">{v.name}</span>
                        {v.code && <span className="ml-1.5 font-mono text-[11px] text-gray-400">{v.code}</span>}
                      </span>
                      {isCurrent ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                          <Check className="h-3.5 w-3.5" /> current
                        </span>
                      ) : (
                        <span className="text-[11px] font-medium text-teal-600">Use</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* ── Tier 2: From the catalog ── */}
      {tier === 'catalog' && (
        <div>
          {recLoading ? (
            <RowSpinner label="Finding catalog matches…" />
          ) : !catalog || catalog.length === 0 ? (
            <div className="py-3 text-center text-xs text-gray-500">
              Nothing matched in the shared catalog for this item.
              {webAvailable && (
                <button
                  type="button"
                  onClick={() => setTier('web')}
                  className="ml-1 font-medium text-teal-600 underline"
                >
                  Try a web search
                </button>
              )}
            </div>
          ) : (
            <ul className="space-y-2">
              {catalog.map((c) => {
                const key = `cat:${c.catalog_vendor_id}`;
                const st = rowStates[key] || {};
                const where = [c.city, c.state].filter(Boolean).join(', ');
                return (
                  <li key={key} className="rounded-md border border-gray-200 bg-white p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-gray-900">{c.name}</div>
                        <div className="mt-0.5 text-[11px] text-gray-500">
                          {where || 'Shared catalog vendor'}
                          {c.industry_tags.length > 0 && ` · ${c.industry_tags.slice(0, 3).join(', ')}`}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => adoptCatalog(c)}
                        disabled={st.busy}
                        className="inline-flex shrink-0 items-center gap-1 rounded-md bg-teal-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:bg-gray-300"
                      >
                        {st.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                        Add &amp; use
                      </button>
                    </div>
                    {st.error && <p className="mt-1.5 text-[11px] text-red-600">{st.error}</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* ── Tier 3: Search the web ── */}
      {tier === 'web' && (
        <div>
          <div className="mb-2 flex gap-1.5">
            <input
              type="text"
              value={webQuery}
              onChange={(e) => setWebQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') runWebSearch();
              }}
              placeholder={suggestedQuery || 'e.g. wheel stop supplier near Portland'}
              className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-300"
            />
            <button
              type="button"
              onClick={runWebSearch}
              disabled={webSearching || !webQuery.trim()}
              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-gray-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-900 disabled:bg-gray-300"
            >
              {webSearching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              Search
            </button>
          </div>

          {webSearching ? (
            <RowSpinner label="Searching the web…" />
          ) : webResults == null ? (
            <p className="py-2 text-center text-[11px] text-gray-400">
              Search finds real suppliers online. Adding one runs a duplicate check first.
            </p>
          ) : webResults.length === 0 ? (
            <p className="py-3 text-center text-xs text-gray-500">No results — try different wording.</p>
          ) : (
            <ul className="space-y-2">
              {webResults.map((c, i) => {
                const key = `web:${i}:${c.name}`;
                const st = rowStates[key] || {};
                const where = [c.city, c.state].filter(Boolean).join(', ');
                return (
                  <li key={key} className="rounded-md border border-gray-200 bg-white p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-gray-900">{c.name}</div>
                        <div className="mt-0.5 truncate text-[11px] text-gray-500">
                          {[c.category, where, c.phone].filter(Boolean).join(' · ') || c.website || 'Web result'}
                        </div>
                      </div>
                      {!st.gate && (
                        <button
                          type="button"
                          onClick={() => createFromWeb(c, key, false)}
                          disabled={st.busy}
                          className="inline-flex shrink-0 items-center gap-1 rounded-md bg-teal-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:bg-gray-300"
                        >
                          {st.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                          Add &amp; use
                        </button>
                      )}
                    </div>

                    {/* STRONG duplicate gate */}
                    {st.gate && (
                      <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2">
                        <p className="text-[11px] font-medium text-amber-800">
                          Looks like you already have{' '}
                          <span className="font-semibold">{st.gate.matches[0].vendor_name}</span>
                          {st.gate.matches[0].confidence != null && ` (${Math.round(st.gate.matches[0].confidence)}% match)`}
                          . Use that instead?
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              onPick({
                                vendor_id: st.gate!.matches[0].vendor_id,
                                name: st.gate!.matches[0].vendor_name,
                                code: null,
                              })
                            }
                            className="rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700"
                          >
                            Use {st.gate.matches[0].vendor_name}
                          </button>
                          <button
                            type="button"
                            onClick={() => createFromWeb(c, key, true)}
                            className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
                          >
                            Create anyway
                          </button>
                          <button
                            type="button"
                            onClick={() => patchRow(key, { gate: null })}
                            className="rounded-md px-2.5 py-1 text-[11px] font-medium text-gray-500 hover:bg-gray-100"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {st.error && <p className="mt-1.5 text-[11px] text-red-600">{st.error}</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ── Small presentational helpers ─────────────────────────────────────────

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1 rounded px-2 py-1.5 font-medium transition-colors ${
        active ? 'bg-white text-teal-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function RowSpinner({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-4 text-xs text-gray-500">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}
