'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AppError } from '@rocketmanv9/chassis/errors';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { FilterBar } from '@/components/ui/FilterBar';
import { DataTable } from '@/components/ui/DataTable';
import { StatusChip } from '@/components/ui/StatusChip';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { CreateAssetModal } from '@/components/assets/CreateAssetModal';

interface AssetRow {
  id: string;
  asset_tag: string;
  serial_number: string | null;
  asset_kind?: string | null;
  status: string | null;
  catalog_item?: { name?: string | null } | null;
  location?: { name?: string | null } | null;
  asset_state?: { current_status?: string | null } | null;
}

interface CatalogItem { id: string; name: string; make?: string | null; model?: string | null; year?: number | null; description?: string | null }

/**
 * Per-type asset view that mirrors the fleet app: real assets (inventory.assets
 * filtered by asset_kind) on the "My X" tab, and the shared GV catalog to adopt
 * from on the "Catalog" tab. Tools have no catalog, so only the registry shows.
 */
export function AssetKindView({
  kind, labelPlural, labelSingular, catalogEndpoint, adoptEndpoint, adoptBodyKey,
}: {
  kind: 'vehicle' | 'equipment' | 'tool';
  labelPlural: string;
  labelSingular: string;
  catalogEndpoint?: string;
  adoptEndpoint?: string;
  adoptBodyKey?: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<'mine' | 'catalog'>('mine');
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await InventoryRPC.getAssets();
        if (!cancelled) setAssets((data || []).filter((a: AssetRow) => a.asset_kind === kind));
      } catch (e) {
        console.error('Error fetching assets:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [kind, refreshKey]);

  const status = (a: AssetRow) => a.asset_state?.current_status || a.status || 'available';

  const filtered = useMemo(() => {
    const s = (filters.search || '').toLowerCase();
    return assets.filter((a) => !s || a.asset_tag.toLowerCase().includes(s) || (a.serial_number?.toLowerCase().includes(s)));
  }, [assets, filters.search]);

  const columns = [
    { key: 'asset_tag', header: 'Asset Tag', sortable: true, render: (r: AssetRow) => <span className="font-mono font-medium">{r.asset_tag}</span> },
    { key: 'name', header: labelSingular, render: (r: AssetRow) => r.catalog_item?.name || '—' },
    { key: 'serial_number', header: 'Serial', render: (r: AssetRow) => <span className="font-mono text-sm">{r.serial_number || '—'}</span> },
    { key: 'location', header: 'Location', render: (r: AssetRow) => r.location?.name || '—' },
    { key: 'status', header: 'Status', render: (r: AssetRow) => <StatusChip status={status(r)} /> },
  ];

  // --- Catalog (GV) ---
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [catLoading, setCatLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adopting, setAdopting] = useState(false);
  useEffect(() => {
    if (tab !== 'catalog' || !catalogEndpoint || catalog.length) return;
    let cancelled = false;
    (async () => {
      setCatLoading(true);
      try {
        const res = await fetch(catalogEndpoint);
        const json = res.ok ? await res.json() : { data: [] };
        if (!cancelled) setCatalog(json.data || []);
      } catch { /* empty state */ } finally { if (!cancelled) setCatLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [tab, catalogEndpoint, catalog.length]);

  const adopt = async () => {
    if (!adoptEndpoint || selected.size === 0) return;
    setAdopting(true);
    try {
      const res = await fetch(adoptEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ [adoptBodyKey || 'catalogIds']: Array.from(selected) }),
      });
      if (!res.ok) throw AppError.internal('Failed to adopt');
      setSelected(new Set());
      setTab('mine');
    } catch { alert('Failed to adopt selected items'); } finally { setAdopting(false); }
  };

  const tabBtn = (active: boolean) =>
    `border-b-2 px-4 py-2 text-sm font-medium transition-colors ${active ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`;

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title={labelPlural}
          description={`Your ${labelPlural.toLowerCase()}, synced with Fleet. Add from the shared catalog or onboard from the Assets page.`}
          actions={
            tab === 'catalog' && selected.size > 0 ? (
              <button onClick={adopt} disabled={adopting} className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50">
                {adopting ? 'Adding…' : `Add Selected (${selected.size})`}
              </button>
            ) : tab === 'mine' ? (
              <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90">
                + Add {labelSingular}
              </button>
            ) : null
          }
        />

        {showCreate && (
          <CreateAssetModal
            lockedKind={kind}
            onClose={() => setShowCreate(false)}
            onComplete={() => { setShowCreate(false); setRefreshKey((k) => k + 1); }}
          />
        )}

        {catalogEndpoint && (
          <div className="flex gap-2 border-b">
            <button onClick={() => setTab('mine')} className={tabBtn(tab === 'mine')}>My {labelPlural}</button>
            <button onClick={() => setTab('catalog')} className={tabBtn(tab === 'catalog')}>Catalog</button>
          </div>
        )}

        {tab === 'mine' || !catalogEndpoint ? (
          <>
            <FilterBar
              filters={[{ key: 'search', label: 'Search', type: 'search', placeholder: 'Asset tag or serial...' }]}
              values={filters}
              onChange={(k, v) => setFilters((f) => ({ ...f, [k]: v }))}
              onClear={() => setFilters({})}
            />
            <DataTable
              data={filtered}
              columns={columns}
              loading={loading}
              emptyMessage={`No ${labelPlural.toLowerCase()} yet.`}
              rowKey={(r) => r.id}
              onRowClick={(r) => router.push(`/inventory/assets/${r.id}`)}
            />
          </>
        ) : catLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">Loading catalog…</div>
        ) : catalog.length === 0 ? (
          <div className="rounded-lg border bg-card p-12 text-center"><p className="text-muted-foreground">No catalog items available.</p></div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {catalog.map((c) => {
              const sel = selected.has(c.id);
              return (
                <div key={c.id} onClick={() => setSelected((p) => { const n = new Set(p); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })}
                  className={`p-4 border rounded-lg cursor-pointer transition-colors ${sel ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
                  <div className="font-medium">{c.name}</div>
                  <div className="text-sm text-muted-foreground mt-1">{[c.make, c.model, c.year].filter(Boolean).join(' / ') || 'No details'}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
