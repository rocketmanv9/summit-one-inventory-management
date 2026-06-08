'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Package,
  MapPin,
  Tag,
  Clock,
  AlertTriangle,
  User,
  History,
  ShieldCheck,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusChip } from '@/components/ui/StatusChip';
import { EntityImageUpload } from '@/components/ui/EntityImageUpload';
import { AssetTransferModal } from '@/components/assets/AssetTransferModal';
import { InventoryRPC } from '@/lib/rpc/inventory';

type Asset = Awaited<ReturnType<typeof InventoryRPC.getAssetById>>;
type History = Awaited<ReturnType<typeof InventoryRPC.getAssetHistory>>;

function formatTimestamp(ts: string | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function formatDate(ts: string | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function titleize(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.round(ms / 86_400_000));
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-right">{value || '—'}</span>
    </div>
  );
}

export default function AssetDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [asset, setAsset] = useState<Asset>(null);
  const [history, setHistory] = useState<History>({ assignments: [], events: [] });
  const [typeLabels, setTypeLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showTransfer, setShowTransfer] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!params.id) return;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const [a, h, types] = await Promise.all([
          InventoryRPC.getAssetById(params.id),
          InventoryRPC.getAssetHistory(params.id),
          InventoryRPC.getAssignmentTypes(),
        ]);
        if (!a) {
          setError('Asset not found');
          return;
        }
        setAsset(a);
        setHistory(h);
        setTypeLabels(
          Object.fromEntries((types || []).map((t) => [t.type_key, t.display_name])),
        );
      } catch (err: any) {
        setError(err.message || 'Failed to load asset');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [params.id, reloadToken]);

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-20 text-muted-foreground">Loading asset…</div>
      </AppShell>
    );
  }

  if (error || !asset) {
    return (
      <AppShell>
        <div className="space-y-4 py-10">
          <button
            onClick={() => router.push('/inventory/assets')}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Assets
          </button>
          <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
            <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-red-500" />
            <p className="text-sm text-red-600">{error || 'Asset not found'}</p>
          </div>
        </div>
      </AppShell>
    );
  }

  const status = asset.asset_state?.current_status || asset.status || 'available';
  const typeLabel = (key: string | null) => (key ? typeLabels[key] || titleize(key) : '');
  const currentAssignment = history.assignments.find((a) => !a.returned_at) || null;
  const warrantyExpired =
    asset.warranty_expires != null && new Date(asset.warranty_expires).getTime() < Date.now();

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <button
            onClick={() => router.push('/inventory/assets')}
            className="mb-3 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Assets
          </button>
          <div className="flex items-start gap-4">
            <EntityImageUpload entityType="asset" entityId={asset.id} size="lg" />
            <div className="flex-1 min-w-0">
              <PageHeader
                title={asset.asset_tag}
                description={
                  [
                    asset.catalog_item?.name,
                    asset.catalog_item?.sku && `SKU: ${asset.catalog_item.sku}`,
                    asset.serial_number && `SN: ${asset.serial_number}`,
                  ].filter(Boolean).join('  |  ')
                }
                actions={
                  <div className="flex items-center gap-3">
                    <StatusChip status={status} />
                    <button
                      onClick={() => setShowTransfer(true)}
                      className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted transition-colors"
                    >
                      <MapPin className="h-4 w-4" /> Transfer
                    </button>
                  </div>
                }
              />
            </div>
          </div>
        </div>

        {showTransfer && (
          <AssetTransferModal
            asset={asset}
            onClose={() => setShowTransfer(false)}
            onComplete={() => {
              setShowTransfer(false);
              setReloadToken((t) => t + 1);
            }}
          />
        )}

        {/* Current assignment banner */}
        {currentAssignment && (
          <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
            <User className="h-5 w-5 shrink-0 text-blue-600" />
            <div className="text-sm">
              <span className="font-medium text-blue-800">
                Assigned to {typeLabel(currentAssignment.assigned_to_type)}: {currentAssignment.assigned_to_id}
              </span>
              <span className="text-blue-700"> — since {formatDate(currentAssignment.assigned_at)}</span>
              {currentAssignment.notes && (
                <p className="text-xs text-blue-700/80 mt-0.5">{currentAssignment.notes}</p>
              )}
            </div>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Details */}
          <div className="rounded-xl border bg-background p-5">
            <h3 className="mb-3 flex items-center gap-2 text-base font-semibold">
              <Tag className="h-4 w-4" /> Details
            </h3>
            <InfoRow label="Catalog Item" value={asset.catalog_item?.name} />
            <InfoRow label="SKU" value={asset.catalog_item?.sku} />
            <InfoRow label="Serial Number" value={asset.serial_number} />
            {asset.vin && <InfoRow label="VIN" value={asset.vin} />}
            <InfoRow
              label="Current Location"
              value={
                asset.location?.name ? (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground" /> {asset.location.name}
                  </span>
                ) : null
              }
            />
            <InfoRow label="Status" value={<StatusChip status={status} />} />
          </div>

          {/* Purchase & warranty */}
          <div className="rounded-xl border bg-background p-5">
            <h3 className="mb-3 flex items-center gap-2 text-base font-semibold">
              <ShieldCheck className="h-4 w-4" /> Purchase &amp; Warranty
            </h3>
            <InfoRow label="Purchase Date" value={formatDate(asset.purchase_date)} />
            <InfoRow
              label="Purchase Cost"
              value={asset.purchase_cost != null ? `$${Number(asset.purchase_cost).toLocaleString()}` : null}
            />
            <InfoRow
              label="Warranty Expires"
              value={
                asset.warranty_expires ? (
                  <span className={warrantyExpired ? 'text-red-600' : ''}>
                    {formatDate(asset.warranty_expires)}{warrantyExpired ? ' (expired)' : ''}
                  </span>
                ) : null
              }
            />
            <InfoRow label="Created" value={formatTimestamp(asset.created_at)} />
            <InfoRow label="Last Movement" value={formatTimestamp(asset.asset_state?.last_movement_at)} />
          </div>
        </div>

        {/* Assignment history */}
        <div>
          <h3 className="mb-3 flex items-center gap-2 text-base font-semibold">
            <History className="h-4 w-4" /> Assignment History ({history.assignments.length})
          </h3>
          {history.assignments.length > 0 ? (
            <div className="rounded-xl border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Assigned To</th>
                    <th className="px-4 py-2.5 font-medium">Out</th>
                    <th className="px-4 py-2.5 font-medium">Returned</th>
                    <th className="px-4 py-2.5 font-medium">Duration</th>
                    <th className="px-4 py-2.5 font-medium">Condition</th>
                  </tr>
                </thead>
                <tbody>
                  {history.assignments.map((a) => {
                    const days = daysBetween(a.assigned_at, a.returned_at);
                    return (
                      <tr key={a.id} className="border-b last:border-0">
                        <td className="px-4 py-2.5">
                          <span className="font-medium">{typeLabel(a.assigned_to_type)}</span>
                          {a.assigned_to_id && <span className="text-muted-foreground">: {a.assigned_to_id}</span>}
                          {a.notes && <div className="text-xs text-muted-foreground">{a.notes}</div>}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">{formatDate(a.assigned_at)}</td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          {a.returned_at ? formatDate(a.returned_at) : (
                            <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                              Currently out
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                          {days != null ? `${days} day${days === 1 ? '' : 's'}` : '—'}
                        </td>
                        <td className="px-4 py-2.5">
                          {a.return_condition ? titleize(a.return_condition) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No assignment history yet.
            </div>
          )}
        </div>

        {/* Activity log (events) */}
        <div>
          <h3 className="mb-3 flex items-center gap-2 text-base font-semibold">
            <Clock className="h-4 w-4" /> Activity Log ({history.events.length})
          </h3>
          {history.events.length > 0 ? (
            <ol className="relative space-y-3 border-l pl-5">
              {history.events.map((e) => (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[1.42rem] top-1 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary" />
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-medium">{titleize(e.event_type)}</span>
                    <span className="text-xs text-muted-foreground">{formatTimestamp(e.occurred_at)}</span>
                  </div>
                  {e.payload && Object.keys(e.payload).length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {Object.entries(e.payload)
                        .filter(([, v]) => v != null && v !== '')
                        .map(([k, v]) => `${titleize(k)}: ${String(v)}`)
                        .join(' · ')}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No activity recorded yet. Assign or return this asset to start the audit trail.
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
