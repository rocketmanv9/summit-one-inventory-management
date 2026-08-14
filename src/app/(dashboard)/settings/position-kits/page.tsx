'use client';

/**
 * Position kits — "what every new hire in this position gets" (item 03,
 * kits/amazon/fleet sprint).
 *
 * Grant's intent: "an estimator gets a laptop, 3 polos, pens." Admins define a
 * kit per HR position, optionally overridden per location, and choose whether
 * the shortfall gets DRAFTED as a PO or ordered automatically. Item 04 runs it
 * on real hires; the "preview a hire" panel here is the read-only dry run of
 * that same engine (shared helpers in src/lib/position-kits.ts), so what an
 * admin sees is exactly what the automation will do.
 *
 * Sibling of /inventory/buying-access — same design language, different job:
 * buying access is self-service shopping, kits are issuance.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Backpack, Loader2, Plus, Pencil, Power, Eye, X, Trash2, MapPin, Users } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { apiWrite } from '@/lib/api-client';

interface KitItem {
  id?: string;
  catalog_item_id: string;
  qty: number;
  preferred_vendor_id: string | null;
  note: string | null;
  sort_order: number;
  name?: string | null;
  sku?: string | null;
  vendor_name?: string | null;
}

interface Kit {
  id: string;
  hr_position_id: string;
  location_id: string | null;
  name: string;
  description: string | null;
  active: boolean;
  order_mode: 'draft' | 'auto_submit';
  position_title: string | null;
  position_people: number;
  location_name: string | null;
  items: KitItem[];
}

interface Options {
  positions: Array<{ hr_position_id: string; title: string; people: number }>;
  locations: Array<{ id: string; name: string }>;
  catalog: Array<{ id: string; sku: string | null; name: string }>;
}

interface PlanLine {
  catalog_item_id: string;
  name: string | null;
  sku: string | null;
  note: string | null;
  needed: number;
  have: number;
  reserve: number;
  shortfall: number;
}

interface Preview {
  kit: { id: string; name: string; scope: string; order_mode: string } | null;
  plan: { lines: PlanLine[]; total_needed: number; total_reserve: number; total_shortfall: number } | null;
}

type VendorOption = { vendor_id: string; vendor_name: string | null; unit_cost: number | null; is_preferred: boolean };

/**
 * Read a response into either its payload or a human message.
 *
 * A failed fetch on this screen is UI state, not a server error — and the
 * chassis compliance scanner bans raw `throw new Error` anywhere under src/,
 * client components included. So: no throwing, just a discriminated result the
 * caller can drop straight into setError().
 */
async function readJson(res: Response): Promise<{ ok: true; json: any } | { ok: false; message: string }> {
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, message: json?.error?.message || `Request failed (${res.status})` };
  return { ok: true, json };
}

export default function PositionKitsPage() {
  // useViewAs()-style hooks only work inside <AppShell>; keep the content in a
  // child component so this page can grow the same way its siblings did.
  return (
    <AppShell>
      <PositionKitsContent />
    </AppShell>
  );
}

function PositionKitsContent() {
  const [kits, setKits] = useState<Kit[]>([]);
  const [options, setOptions] = useState<Options>({ positions: [], locations: [], catalog: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [editing, setEditing] = useState<Kit | null>(null);
  const [creating, setCreating] = useState(false);
  const [previewFor, setPreviewFor] = useState<Kit | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [kitsRes, optRes] = await Promise.all([
        fetch('/api/inventory/position-kits', { credentials: 'include' }),
        fetch('/api/inventory/position-kits/options', { credentials: 'include' }),
      ]);
      const kitsResult = await readJson(kitsRes);
      const optResult = await readJson(optRes);
      if (!kitsResult.ok) { setError(kitsResult.message); return; }
      if (!optResult.ok) { setError(optResult.message); return; }
      setKits((kitsResult.json.data ?? []) as Kit[]);
      setOptions(optResult.json.data as Options);
    } catch (e: any) {
      setError(e?.message || 'Failed to load position kits.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleActive = async (kit: Kit) => {
    try {
      const res = await apiWrite(`/api/inventory/position-kits/${kit.id}`, {
        method: 'PATCH',
        body: { active: !kit.active },
      });
      const result = await readJson(res);
      if (!result.ok) { setError(result.message); return; }
      await load();
    } catch (e: any) {
      setError(e?.message || 'Could not change the kit.');
    }
  };

  // Cards are grouped by position so a position with an all-locations kit AND a
  // location override reads as one thing with two scopes, not two strangers.
  const grouped = useMemo(() => {
    const byPosition = new Map<string, Kit[]>();
    for (const k of kits) {
      const key = k.position_title ?? k.hr_position_id;
      if (!byPosition.has(key)) byPosition.set(key, []);
      byPosition.get(key)!.push(k);
    }
    return Array.from(byPosition.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [kits]);

  return (
    <div className="p-6">
      <PageHeader
        title="Position kits"
        description="What every new hire in a position gets issued — a laptop, three polos, pens. Item 04's automation reserves what's on the shelf and orders the rest."
      />

      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={() => { setCreating(true); setEditing(null); }}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> New kit
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading kits…</div>
      ) : kits.length === 0 ? (
        <div className="max-w-2xl rounded-lg border border-dashed bg-white p-8 text-center">
          <Backpack className="mx-auto h-8 w-8 text-gray-400" />
          <p className="mt-3 font-medium">No kits yet</p>
          <p className="mt-1 text-sm text-gray-500">
            Define what a new Estimator, Sweeper Driver, or Foreman should walk out with on day one.
          </p>
        </div>
      ) : (
        <div className="max-w-5xl space-y-6">
          {grouped.map(([title, positionKits]) => (
            <div key={title}>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
                {title}
                <span className="ml-2 font-normal normal-case text-gray-400">
                  {positionKits[0]?.position_people ?? 0} active {positionKits[0]?.position_people === 1 ? 'person' : 'people'}
                </span>
              </h3>
              <div className="space-y-3">
                {positionKits.map((kit) => (
                  <div
                    key={kit.id}
                    className={`rounded-lg border bg-white p-4 ${kit.active ? '' : 'opacity-60'}`}
                  >
                    <div className="flex flex-wrap items-start gap-3">
                      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Backpack className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{kit.name}</span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                            <MapPin className="h-3 w-3" />
                            {kit.location_name ?? 'All locations'}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-xs ${kit.order_mode === 'auto_submit' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}`}>
                            {kit.order_mode === 'auto_submit' ? 'Orders automatically' : 'Drafts a PO'}
                          </span>
                          {!kit.active && <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-700">Inactive</span>}
                        </div>
                        <p className="mt-1 text-sm text-gray-500">
                          {kit.items.length} {kit.items.length === 1 ? 'item' : 'items'}
                          {kit.items.length > 0 && ` — ${kit.items.slice(0, 4).map((i) => `${i.qty}× ${i.name ?? i.sku ?? 'item'}`).join(', ')}${kit.items.length > 4 ? '…' : ''}`}
                        </p>
                        {kit.description && <p className="mt-1 text-sm text-gray-400">{kit.description}</p>}
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-1">
                        <button onClick={() => setPreviewFor(kit)} title="Preview a hire" className="rounded p-2 text-gray-500 hover:bg-gray-100">
                          <Eye className="h-4 w-4" />
                        </button>
                        <button onClick={() => { setEditing(kit); setCreating(false); }} title="Edit" className="rounded p-2 text-gray-500 hover:bg-gray-100">
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button onClick={() => toggleActive(kit)} title={kit.active ? 'Deactivate' : 'Reactivate'} className="rounded p-2 text-gray-500 hover:bg-gray-100">
                          <Power className={`h-4 w-4 ${kit.active ? '' : 'text-green-600'}`} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <KitEditor
          kit={editing}
          options={options}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={async () => { setCreating(false); setEditing(null); await load(); }}
        />
      )}

      {previewFor && (
        <HirePreview kit={previewFor} options={options} onClose={() => setPreviewFor(null)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

function KitEditor({ kit, options, onClose, onSaved }: {
  kit: Kit | null;
  options: Options;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [hrPositionId, setHrPositionId] = useState(kit?.hr_position_id ?? '');
  const [locationId, setLocationId] = useState(kit?.location_id ?? '');
  const [name, setName] = useState(kit?.name ?? '');
  const [description, setDescription] = useState(kit?.description ?? '');
  const [orderMode, setOrderMode] = useState<'draft' | 'auto_submit'>(kit?.order_mode ?? 'draft');
  const [items, setItems] = useState<KitItem[]>(kit?.items ?? []);
  const [search, setSearch] = useState('');
  const [vendorOptions, setVendorOptions] = useState<Record<string, VendorOption[]>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  // Vendor choices come from the SAME endpoint the buying-access editor uses —
  // one source of truth for "which vendors actually sell this".
  useEffect(() => {
    const ids = items.map((i) => i.catalog_item_id).filter((id) => !(id in vendorOptions));
    if (ids.length === 0) return;
    (async () => {
      try {
        const res = await fetch(`/api/inventory/buyable-groups/vendor-options?catalog_item_ids=${ids.join(',')}`, { credentials: 'include' });
        const json = await res.json().catch(() => ({}));
        if (res.ok) {
          setVendorOptions((prev) => {
            const next = { ...prev };
            for (const id of ids) next[id] = (json.data?.[id] ?? []) as VendorOption[];
            return next;
          });
        }
      } catch { /* vendor pinning is optional — a failed lookup just leaves the picker empty */ }
    })();
  }, [items, vendorOptions]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    const chosen = new Set(items.map((i) => i.catalog_item_id));
    return options.catalog
      .filter((c) => !chosen.has(c.id))
      .filter((c) => c.name.toLowerCase().includes(q) || (c.sku ?? '').toLowerCase().includes(q))
      .slice(0, 8);
  }, [search, options.catalog, items]);

  const addItem = (c: { id: string; sku: string | null; name: string }) => {
    setItems((prev) => [...prev, {
      catalog_item_id: c.id,
      qty: 1,
      preferred_vendor_id: null,
      note: null,
      sort_order: prev.length,
      name: c.name,
      sku: c.sku,
    }]);
    setSearch('');
  };

  const patchItem = (idx: number, patch: Partial<KitItem>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const removeItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx).map((it, i) => ({ ...it, sort_order: i })));
  };

  const save = async () => {
    if (!hrPositionId) { setErr('Pick a position.'); return; }
    if (!name.trim()) { setErr('Name the kit.'); return; }
    setSaving(true);
    setErr('');
    try {
      const body = {
        hr_position_id: hrPositionId,
        location_id: locationId || null,
        name: name.trim(),
        description: description.trim() || null,
        order_mode: orderMode,
        items: items.map((it, idx) => ({
          catalog_item_id: it.catalog_item_id,
          qty: Number(it.qty) || 1,
          preferred_vendor_id: it.preferred_vendor_id || null,
          note: (it.note ?? '').trim() || null,
          sort_order: idx,
        })),
      };
      const res = kit
        ? await apiWrite(`/api/inventory/position-kits/${kit.id}`, { method: 'PATCH', body })
        : await apiWrite('/api/inventory/position-kits', { method: 'POST', body });
      const result = await readJson(res);
      if (!result.ok) { setErr(result.message); return; }
      onSaved();
    } catch (e: any) {
      setErr(e?.message || 'Could not save. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const selectedPosition = options.positions.find((p) => p.hr_position_id === hrPositionId);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="mt-8 w-full max-w-3xl rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b p-4">
          <h2 className="text-lg font-semibold">{kit ? 'Edit kit' : 'New kit'}</h2>
          <button onClick={onClose} className="rounded p-1 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-4 p-4">
          {err && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div>}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Position</label>
              <select
                value={hrPositionId}
                onChange={(e) => {
                  setHrPositionId(e.target.value);
                  const p = options.positions.find((x) => x.hr_position_id === e.target.value);
                  if (p && !name.trim()) setName(`${p.title} starter kit`);
                }}
                className="w-full rounded-md border px-3 py-2"
              >
                <option value="">Select a position…</option>
                {options.positions.map((p) => (
                  <option key={p.hr_position_id} value={p.hr_position_id}>
                    {p.title} ({p.people} active)
                  </option>
                ))}
              </select>
              {selectedPosition && (
                <p className="mt-1 flex items-center gap-1 text-xs text-gray-500">
                  <Users className="h-3 w-3" /> {selectedPosition.people} people hold this position today
                </p>
              )}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Location scope</label>
              <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="w-full rounded-md border px-3 py-2">
                <option value="">All locations</option>
                {options.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              <p className="mt-1 text-xs text-gray-500">A location kit overrides the all-locations kit for that location.</p>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Kit name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-md border px-3 py-2" placeholder="Estimator starter kit" />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Notes (optional)</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} className="w-full rounded-md border px-3 py-2" placeholder="Issued on day one, before the first job walk." />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">When stock is short</label>
            <div className="flex gap-2">
              {(['draft', 'auto_submit'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setOrderMode(mode)}
                  className={`rounded-md border px-3 py-2 text-sm ${orderMode === mode ? 'border-primary bg-primary/5 text-primary' : 'text-gray-600'}`}
                >
                  {mode === 'draft' ? 'Draft a purchase order' : 'Order it automatically'}
                </button>
              ))}
            </div>
          </div>

          {/* Item table */}
          <div>
            <label className="mb-1 block text-sm font-medium">What they get</label>
            <div className="rounded-md border">
              {items.length === 0 && <p className="p-3 text-sm text-gray-500">No items yet — search the catalog below.</p>}
              {items.map((it, idx) => (
                <div key={it.catalog_item_id} className="flex flex-wrap items-center gap-2 border-b p-2 last:border-b-0">
                  <input
                    type="number"
                    min={1}
                    value={it.qty}
                    onChange={(e) => patchItem(idx, { qty: Math.max(1, Number(e.target.value) || 1) })}
                    className="w-16 rounded border px-2 py-1 text-sm"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{it.name ?? it.catalog_item_id}</div>
                    {it.sku && <div className="text-xs text-gray-400">{it.sku}</div>}
                  </div>
                  <select
                    value={it.preferred_vendor_id ?? ''}
                    onChange={(e) => patchItem(idx, { preferred_vendor_id: e.target.value || null })}
                    className="rounded border px-2 py-1 text-sm"
                  >
                    <option value="">Best vendor</option>
                    {(vendorOptions[it.catalog_item_id] ?? []).map((v) => (
                      <option key={v.vendor_id} value={v.vendor_id}>
                        {v.vendor_name ?? 'Vendor'}{v.unit_cost != null ? ` — $${v.unit_cost}` : ''}
                      </option>
                    ))}
                  </select>
                  <input
                    value={it.note ?? ''}
                    onChange={(e) => patchItem(idx, { note: e.target.value })}
                    placeholder="size / spec"
                    className="w-40 rounded border px-2 py-1 text-sm"
                  />
                  <button onClick={() => removeItem(idx)} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="relative mt-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search the catalog to add an item…"
                className="w-full rounded-md border px-3 py-2"
              />
              {matches.length > 0 && (
                <div className="absolute z-10 mt-1 w-full rounded-md border bg-white shadow-lg">
                  {matches.map((c) => (
                    <button key={c.id} onClick={() => addItem(c)} className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50">
                      <span className="font-medium">{c.name}</span>
                      {c.sku && <span className="ml-2 text-xs text-gray-400">{c.sku}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t p-4">
          <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm">Cancel</button>
          <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save kit
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preview a hire — read-only dry run of item 04's engine
// ---------------------------------------------------------------------------

function HirePreview({ kit, options, onClose }: { kit: Kit; options: Options; onClose: () => void }) {
  const [locationId, setLocationId] = useState(kit.location_id ?? options.locations[0]?.id ?? '');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!locationId) return;
    setLoading(true);
    setErr('');
    (async () => {
      try {
        const res = await fetch(
          `/api/inventory/position-kits/preview?hr_position_id=${kit.hr_position_id}&location_id=${locationId}`,
          { credentials: 'include' },
        );
        const result = await readJson(res);
        if (!result.ok) { setErr(result.message); return; }
        setPreview(result.json.data as Preview);
      } catch (e: any) {
        setErr(e?.message || 'Could not build the preview.');
      } finally {
        setLoading(false);
      }
    })();
  }, [kit.hr_position_id, locationId]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="mt-8 w-full max-w-3xl rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b p-4">
          <div>
            <h2 className="text-lg font-semibold">Preview a hire</h2>
            <p className="text-sm text-gray-500">{kit.position_title ?? 'Position'} — what would be reserved vs ordered.</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-4 p-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Hire&apos;s location</label>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="w-full rounded-md border px-3 py-2 sm:w-72">
              {options.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>

          {err && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div>}
          {loading && <div className="flex items-center gap-2 text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Planning…</div>}

          {!loading && preview && !preview.kit && (
            <div className="rounded-md border border-dashed p-4 text-sm text-gray-500">
              No active kit resolves for this position at that location.
            </div>
          )}

          {!loading && preview?.plan && (
            <>
              <p className="text-sm text-gray-500">
                Resolved kit: <span className="font-medium text-gray-700">{preview.kit?.name}</span>{' '}
                ({preview.kit?.scope === 'location' ? 'location override' : 'all locations'}) —{' '}
                {preview.kit?.order_mode === 'auto_submit' ? 'shortfall ordered automatically' : 'shortfall drafted as a PO'}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-gray-500">
                      <th className="py-2">Item</th>
                      <th className="py-2 text-right">Needed</th>
                      <th className="py-2 text-right">On hand</th>
                      <th className="py-2 text-right">Reserve</th>
                      <th className="py-2 text-right">Order</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.plan.lines.map((l) => (
                      <tr key={l.catalog_item_id} className="border-b last:border-b-0">
                        <td className="py-2">
                          <div className="font-medium">{l.name ?? l.catalog_item_id}</div>
                          {l.note && <div className="text-xs text-gray-400">{l.note}</div>}
                        </td>
                        <td className="py-2 text-right">{l.needed}</td>
                        <td className="py-2 text-right">{l.have}</td>
                        <td className="py-2 text-right text-green-700">{l.reserve}</td>
                        <td className={`py-2 text-right ${l.shortfall > 0 ? 'font-medium text-amber-700' : 'text-gray-400'}`}>{l.shortfall}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="text-sm font-medium">
                      <td className="py-2">Total</td>
                      <td className="py-2 text-right">{preview.plan.total_needed}</td>
                      <td />
                      <td className="py-2 text-right text-green-700">{preview.plan.total_reserve}</td>
                      <td className="py-2 text-right text-amber-700">{preview.plan.total_shortfall}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="text-xs text-gray-400">
                Dry run only — nothing is reserved or ordered from this screen.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
