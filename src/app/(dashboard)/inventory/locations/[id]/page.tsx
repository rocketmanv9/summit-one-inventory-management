'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  MapPin,
  ArrowLeft,
  Package,
  BarChart3,
  CalendarCheck,
  Search,
  AlertTriangle,
  Tag,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { StatusChip } from '@/components/ui/StatusChip';
import { InventoryRPC } from '@/lib/rpc/inventory';

type LocationSnapshot = Awaited<ReturnType<typeof InventoryRPC.getLocationInventorySnapshot>>;

function formatQty(value: number | null | undefined): string {
  if (value == null) return '0';
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function StatCard({
  label,
  value,
  color = 'default',
}: {
  label: string;
  value: string;
  color?: 'default' | 'green' | 'amber' | 'red';
}) {
  const colorMap = {
    default: 'text-foreground',
    green: 'text-emerald-600',
    amber: 'text-amber-600',
    red: 'text-red-600',
  };
  return (
    <div className="rounded-xl border bg-background p-5">
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className={`mt-2 text-3xl font-bold tabular-nums ${colorMap[color]}`}>{value}</p>
    </div>
  );
}

export default function LocationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<LocationSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchFilter, setSearchFilter] = useState('');

  useEffect(() => {
    if (!params.id) return;

    async function load() {
      setLoading(true);
      setError('');
      try {
        const data = await InventoryRPC.getLocationInventorySnapshot(params.id);
        setSnapshot(data);
      } catch (err: any) {
        console.error('[LocationDetail] Error:', err);
        setError(err.message || 'Failed to load location snapshot');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [params.id]);

  const filteredItems = useMemo(() => {
    if (!snapshot) return [];
    if (!searchFilter.trim()) return snapshot.items;
    const q = searchFilter.toLowerCase();
    return snapshot.items.filter(
      (item) =>
        item.item_name.toLowerCase().includes(q) ||
        (item.sku && item.sku.toLowerCase().includes(q))
    );
  }, [snapshot, searchFilter]);

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-20">
          <div className="text-muted-foreground">Loading location details...</div>
        </div>
      </AppShell>
    );
  }

  if (error || !snapshot) {
    return (
      <AppShell>
        <div className="space-y-4 py-10">
          <button
            onClick={() => router.push('/inventory/locations')}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Locations
          </button>
          <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
            <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-red-500" />
            <p className="text-sm text-red-600">{error || 'Location not found'}</p>
          </div>
        </div>
      </AppShell>
    );
  }

  const { location, totals } = snapshot;

  const itemColumns = [
    {
      key: 'item_name',
      header: 'Item',
      sortable: true,
      render: (row: LocationSnapshot['items'][number]) => (
        <button
          onClick={() => router.push(`/inventory/items/${row.item_id}`)}
          className="text-left"
        >
          <div className="font-medium text-primary hover:underline">{row.item_name}</div>
          {row.sku && (
            <div className="font-mono text-xs text-muted-foreground">{row.sku}</div>
          )}
        </button>
      ),
    },
    {
      key: 'unit_of_measure',
      header: 'UOM',
      render: (row: LocationSnapshot['items'][number]) => row.unit_of_measure || '-',
    },
    {
      key: 'on_hand',
      header: 'On Hand',
      className: 'text-right font-mono',
      render: (row: LocationSnapshot['items'][number]) => formatQty(row.on_hand),
    },
    {
      key: 'reserved',
      header: 'Reserved',
      className: 'text-right font-mono',
      render: (row: LocationSnapshot['items'][number]) => formatQty(row.reserved),
    },
    {
      key: 'available',
      header: 'Available',
      className: 'text-right font-mono',
      render: (row: LocationSnapshot['items'][number]) => (
        <span className={Number(row.available) <= 0 ? 'text-red-600 font-semibold' : 'text-emerald-600'}>
          {formatQty(row.available)}
        </span>
      ),
    },
  ];

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Back + Header */}
        <div>
          <button
            onClick={() => router.push('/inventory/locations')}
            className="mb-3 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Locations
          </button>
          <PageHeader
            title={location.name}
            description={
              [
                location.location_type,
                location.address,
                location.max_capacity != null &&
                  `Capacity: ${Number(location.max_capacity).toLocaleString()} ${location.capacity_uom || ''}`,
              ]
                .filter(Boolean)
                .join('  |  ')
            }
            actions={
              <StatusChip status={location.active ? 'active' : 'inactive'} />
            }
          />
        </div>

        {/* Totals */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Total On Hand" value={formatQty(totals.on_hand)} />
          <StatCard
            label="Total Reserved"
            value={formatQty(totals.reserved)}
            color={Number(totals.reserved) > 0 ? 'amber' : 'default'}
          />
          <StatCard
            label="Total Available"
            value={formatQty(totals.available)}
            color={Number(totals.available) > 0 ? 'green' : 'red'}
          />
          <StatCard
            label="Assets Here"
            value={String(totals.asset_count ?? snapshot.assets?.length ?? 0)}
            color={Number(totals.asset_count ?? snapshot.assets?.length ?? 0) > 0 ? 'green' : 'default'}
          />
        </div>

        {/* What's Here table */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-base font-semibold">
              <Package className="h-4 w-4" />
              What&apos;s Here
              <span className="text-sm font-normal text-muted-foreground">
                ({snapshot.items.length} item{snapshot.items.length !== 1 ? 's' : ''})
              </span>
            </h3>

            {/* Quick filter */}
            {snapshot.items.length > 5 && (
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  placeholder="Filter items..."
                  className="h-9 w-full rounded-lg border bg-background pl-9 pr-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            )}
          </div>

          {filteredItems.length > 0 ? (
            <DataTable
              data={filteredItems}
              columns={itemColumns}
              rowKey={(row) => row.item_id}
            />
          ) : snapshot.items.length > 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No items match &quot;{searchFilter}&quot;
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No fungible inventory at this location.
            </div>
          )}
        </div>

        {/* Assets Here table */}
        {snapshot.assets && snapshot.assets.length > 0 && (
          <div>
            <h3 className="mb-3 flex items-center gap-2 text-base font-semibold">
              <Tag className="h-4 w-4" />
              Assets Here
              <span className="text-sm font-normal text-muted-foreground">
                ({snapshot.assets.length} asset{snapshot.assets.length !== 1 ? 's' : ''})
              </span>
            </h3>
            <DataTable
              data={snapshot.assets}
              columns={[
                {
                  key: 'asset_tag',
                  header: 'Asset Tag',
                  sortable: true,
                  render: (row: LocationSnapshot['assets'][number]) => (
                    <span className="font-mono font-medium">{row.asset_tag}</span>
                  ),
                },
                {
                  key: 'item_name',
                  header: 'Item',
                  sortable: true,
                  render: (row: LocationSnapshot['assets'][number]) => (
                    <div>
                      <div className="font-medium">{row.item_name || '-'}</div>
                      {row.sku && (
                        <div className="font-mono text-xs text-muted-foreground">{row.sku}</div>
                      )}
                    </div>
                  ),
                },
                {
                  key: 'serial_number',
                  header: 'Serial #',
                  render: (row: LocationSnapshot['assets'][number]) => row.serial_number || '-',
                },
                {
                  key: 'status',
                  header: 'Status',
                  render: (row: LocationSnapshot['assets'][number]) => (
                    <StatusChip status={row.status} />
                  ),
                },
              ]}
              rowKey={(row) => row.asset_id}
            />
          </div>
        )}
      </div>
    </AppShell>
  );
}
