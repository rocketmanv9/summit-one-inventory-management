'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Package,
  ArrowLeft,
  ArrowLeftRight,
  CalendarCheck,
  ShoppingCart,
  BarChart3,
  MapPin,
  Clock,
  AlertTriangle,
  ScanBarcode,
  Printer,
  Tag,
  Link2,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { StatusChip } from '@/components/ui/StatusChip';
import { BarcodeLabelDialog } from '@/components/modals/BarcodeLabelDialog';
import { BarcodeScannerOverlay } from '@/components/mobile/BarcodeScannerOverlay';
import { EntityImageUpload } from '@/components/ui/EntityImageUpload';
import { ReferenceLinksEditor } from '@/components/items/ReferenceLinksEditor';
import { ItemAmazonMapping } from '@/components/items/ItemAmazonMapping';
import { cleanReferenceLinks, type ReferenceLink } from '@/lib/items/reference-links';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { useUOMLabelMap } from '@/hooks/useGVTerms';

type StockSnapshot = Awaited<ReturnType<typeof InventoryRPC.getItemStockSnapshot>>;

function formatQty(value: number | null | undefined): string {
  if (value == null) return '0';
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return 'Never';
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function StatCard({
  label,
  value,
  color = 'default',
  icon: Icon,
}: {
  label: string;
  value: string;
  color?: 'default' | 'green' | 'amber' | 'red' | 'blue';
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const colorMap = {
    default: 'text-foreground',
    green: 'text-emerald-600',
    amber: 'text-amber-600',
    red: 'text-red-600',
    blue: 'text-blue-600',
  };
  return (
    <div className="rounded-xl border bg-background p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      </div>
      <p className={`mt-2 text-3xl font-bold tabular-nums ${colorMap[color]}`}>{value}</p>
    </div>
  );
}

export default function ItemDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const uomLabels = useUOMLabelMap();
  const [snapshot, setSnapshot] = useState<StockSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Identifiers state
  const [barcode, setBarcode] = useState('');
  const [barcodeDirty, setBarcodeDirty] = useState(false);
  const [barcodeSaving, setBarcodeSaving] = useState(false);
  const [barcodeMsg, setBarcodeMsg] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [showLabelDialog, setShowLabelDialog] = useState(false);

  // Reference links state
  const [links, setLinks] = useState<ReferenceLink[]>([]);
  const [linksDirty, setLinksDirty] = useState(false);
  const [linksSaving, setLinksSaving] = useState(false);
  const [linksMsg, setLinksMsg] = useState('');

  useEffect(() => {
    if (!params.id) return;

    async function load() {
      setLoading(true);
      setError('');
      try {
        const [data, itemLinks] = await Promise.all([
          InventoryRPC.getItemStockSnapshot(params.id),
          InventoryRPC.getCatalogItemLinks(params.id),
        ]);
        setSnapshot(data);
        setLinks(itemLinks);
        setLinksDirty(false);
      } catch (err: any) {
        console.error('[ItemDetail] Error:', err);
        setError(err.message || 'Failed to load item snapshot');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [params.id]);

  // Sync barcode from snapshot
  useEffect(() => {
    if (snapshot?.item?.barcode) {
      setBarcode(snapshot.item.barcode);
    }
  }, [snapshot]);

  const handleSaveBarcode = async () => {
    if (!snapshot?.item) return;
    const lastEventId = snapshot.item.last_event_id;
    if (!lastEventId) {
      setBarcodeMsg('Cannot save — missing event ID. Refresh and try again.');
      return;
    }
    setBarcodeSaving(true);
    setBarcodeMsg('');
    try {
      await InventoryRPC.updateCatalogItem(
        snapshot.item.id,
        { barcode: barcode.trim() || null } as any,
        lastEventId
      );
      setBarcodeDirty(false);
      setBarcodeMsg('Saved');
      // Reload snapshot to get fresh last_event_id
      const fresh = await InventoryRPC.getItemStockSnapshot(params.id);
      setSnapshot(fresh);
      setTimeout(() => setBarcodeMsg(''), 2000);
    } catch (err: any) {
      setBarcodeMsg(`Error: ${err.message}`);
    } finally {
      setBarcodeSaving(false);
    }
  };

  const handleSaveLinks = async () => {
    if (!snapshot?.item) return;
    const lastEventId = snapshot.item.last_event_id;
    if (!lastEventId) {
      setLinksMsg('Cannot save — missing event ID. Refresh and try again.');
      return;
    }
    setLinksSaving(true);
    setLinksMsg('');
    try {
      const clean = cleanReferenceLinks(links);
      await InventoryRPC.updateCatalogItem(
        snapshot.item.id,
        { reference_links: clean } as any,
        lastEventId
      );
      setLinks(clean);
      setLinksDirty(false);
      setLinksMsg('Saved');
      // Reload snapshot to get a fresh last_event_id for the next OCC write.
      const fresh = await InventoryRPC.getItemStockSnapshot(params.id);
      setSnapshot(fresh);
      setTimeout(() => setLinksMsg(''), 2000);
    } catch (err: any) {
      setLinksMsg(`Error: ${err.message}`);
    } finally {
      setLinksSaving(false);
    }
  };

  const handleScanBarcode = (decodedText: string) => {
    // Extract code from URL if QR code encodes a URL
    let code = decodedText;
    try {
      const url = new URL(decodedText);
      const codeParam = url.searchParams.get('code');
      if (codeParam) code = codeParam;
    } catch {
      // Not a URL, use as-is
    }
    setBarcode(code);
    setBarcodeDirty(true);
    setScannerOpen(false);
  };

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-20">
          <div className="text-muted-foreground">Loading item details...</div>
        </div>
      </AppShell>
    );
  }

  if (error || !snapshot) {
    return (
      <AppShell>
        <div className="space-y-4 py-10">
          <button
            onClick={() => router.push('/inventory/items')}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Items
          </button>
          <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
            <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-red-500" />
            <p className="text-sm text-red-600">{error || 'Item not found'}</p>
          </div>
        </div>
      </AppShell>
    );
  }

  const { item } = snapshot;
  const reorderPoint = item.reorder_point ?? 0;
  const isLowStock = reorderPoint > 0 && Number(snapshot.available) <= reorderPoint;

  const locationColumns = [
    {
      key: 'location_name',
      header: 'Location',
      sortable: true,
      render: (row: StockSnapshot['locations'][number]) => (
        <button
          onClick={() => router.push(`/inventory/locations/${row.location_id}`)}
          className="font-medium text-foreground hover:text-primary hover:underline"
        >
          {row.location_name}
        </button>
      ),
    },
    {
      key: 'on_hand',
      header: 'On Hand',
      className: 'text-right font-mono',
      render: (row: StockSnapshot['locations'][number]) => formatQty(row.on_hand),
    },
    {
      key: 'reserved',
      header: 'Reserved',
      className: 'text-right font-mono',
      render: (row: StockSnapshot['locations'][number]) => formatQty(row.reserved),
    },
    {
      key: 'available',
      header: 'Available',
      className: 'text-right font-mono',
      render: (row: StockSnapshot['locations'][number]) => (
        <span className={Number(row.available) <= 0 ? 'text-red-600 font-semibold' : ''}>
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
            onClick={() => router.push('/inventory/items')}
            className="mb-3 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Items
          </button>
          <div className="flex items-start gap-4">
            <EntityImageUpload
              entityType="catalog_item"
              entityId={params.id}
              size="lg"
              generateContext={{ name: item.name, description: (item as any).description || '' }}
            />
            <div className="flex-1 min-w-0">
              <PageHeader
                title={item.name}
                description={
                  [
                    item.sku && `SKU: ${item.sku}`,
                    item.category_name,
                    (item as any).uom_term_id && `UOM: ${uomLabels[(item as any).uom_term_id] || (item as any).uom_term_id}`,
                    item.tracking_mode,
                  ]
                    .filter(Boolean)
                    .join('  |  ')
                }
                actions={
                  <div className="flex items-center gap-2">
                    <StatusChip status={item.active ? 'active' : 'inactive'} />
                  </div>
                }
              />
            </div>
          </div>
        </div>

        {/* Low stock warning */}
        {isLowStock && (
          <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <p className="text-sm font-medium text-amber-800">Low Stock Warning</p>
              <p className="text-xs text-amber-700">
                Available qty ({formatQty(snapshot.available)}) is at or below reorder point ({formatQty(reorderPoint)})
              </p>
            </div>
          </div>
        )}

        {/* Stock Snapshot Cards */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="On Hand"
            value={formatQty(snapshot.on_hand)}
            icon={Package}
          />
          <StatCard
            label="Reserved"
            value={formatQty(snapshot.reserved)}
            color={Number(snapshot.reserved) > 0 ? 'amber' : 'default'}
            icon={CalendarCheck}
          />
          <StatCard
            label="Available"
            value={formatQty(snapshot.available)}
            color={Number(snapshot.available) > 0 ? 'green' : 'red'}
            icon={BarChart3}
          />
          <StatCard
            label="Inbound (Open POs)"
            value={formatQty(snapshot.inbound)}
            color={Number(snapshot.inbound) > 0 ? 'blue' : 'default'}
            icon={ShoppingCart}
          />
        </div>

        {/* Quick Actions */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => router.push(`/inventory/stock?item_id=${params.id}`)}
            className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
          >
            <BarChart3 className="h-4 w-4" />
            Adjust Stock
          </button>
          <button
            onClick={() => router.push(`/inventory/transfers?item_id=${params.id}`)}
            className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
          >
            <ArrowLeftRight className="h-4 w-4" />
            Transfer
          </button>
          <button
            onClick={() => router.push(`/inventory/reservations?item_id=${params.id}`)}
            className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
          >
            <CalendarCheck className="h-4 w-4" />
            Reserve
          </button>
          <button
            onClick={() => router.push(`/inventory/purchasing/create?item_id=${params.id}`)}
            className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
          >
            <ShoppingCart className="h-4 w-4" />
            Create PO
          </button>
        </div>

        {/* Identifiers & Labels */}
        <div className="rounded-xl border bg-background p-5">
          <h3 className="mb-4 flex items-center gap-2 text-base font-semibold">
            <Tag className="h-4 w-4" />
            Identifiers &amp; Labels
          </h3>

          <div className="space-y-4">
            {/* Barcode */}
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1.5">Barcode</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={barcode}
                  onChange={(e) => { setBarcode(e.target.value); setBarcodeDirty(true); }}
                  placeholder="Scan or type barcode..."
                  className="flex-1 px-3 py-2 border rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <button
                  onClick={() => setScannerOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 border rounded-md text-sm font-medium hover:bg-muted transition-colors"
                  title="Scan barcode with camera"
                >
                  <ScanBarcode className="h-4 w-4" />
                  Scan
                </button>
                <button
                  onClick={handleSaveBarcode}
                  disabled={!barcodeDirty || barcodeSaving}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors"
                >
                  {barcodeSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
              {barcodeMsg && (
                <p className={`mt-1.5 text-xs font-medium ${barcodeMsg.startsWith('Error') ? 'text-red-600' : 'text-emerald-600'}`}>
                  {barcodeMsg}
                </p>
              )}
            </div>

            {/* Print Label */}
            <div className="flex items-center gap-3 pt-2 border-t">
              <button
                onClick={() => setShowLabelDialog(true)}
                className="inline-flex items-center gap-2 px-4 py-2 border rounded-md text-sm font-medium hover:bg-muted transition-colors"
              >
                <Printer className="h-4 w-4" />
                Print Label
              </button>
              <span className="text-xs text-muted-foreground">
                Prints barcode (CODE128) + QR code using {barcode || item.sku}
              </span>
            </div>
          </div>
        </div>

        {/* Reference Links */}
        <div className="rounded-xl border bg-background p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-base font-semibold">
              <Link2 className="h-4 w-4" />
              Reference Links
            </h3>
            <div className="flex items-center gap-3">
              {linksMsg && (
                <span className={`text-xs font-medium ${linksMsg.startsWith('Error') ? 'text-red-600' : 'text-emerald-600'}`}>
                  {linksMsg}
                </span>
              )}
              <button
                onClick={handleSaveLinks}
                disabled={!linksDirty || linksSaving}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
              >
                {linksSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            Store product pages, spec sheets, or supplier URLs for quick access and reordering.
          </p>
          <ReferenceLinksEditor
            links={links}
            onChange={(next) => { setLinks(next); setLinksDirty(true); }}
            disabled={linksSaving}
          />
        </div>

        {/* Amazon ordering link for this item */}
        <ItemAmazonMapping catalogItemId={params.id} />

        {/* Scanner overlay */}
        <BarcodeScannerOverlay
          isOpen={scannerOpen}
          onClose={() => setScannerOpen(false)}
          onScan={handleScanBarcode}
        />

        {/* Label print dialog */}
        {showLabelDialog && (
          <BarcodeLabelDialog
            items={[{ code: barcode || item.sku, label: item.name }]}
            entityType="item"
            onClose={() => setShowLabelDialog(false)}
          />
        )}

        {/* Timestamps */}
        <div className="flex flex-wrap gap-6 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            Last movement: {formatTimestamp(snapshot.last_movement_at)}
          </span>
          <span className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            Last count: {formatTimestamp(snapshot.last_count_at)}
          </span>
        </div>

        {/* Variant Grid (parent items only) */}
        {item.is_parent && snapshot.variants && (
          <div>
            <h3 className="mb-3 flex items-center gap-2 text-base font-semibold">
              <Package className="h-4 w-4" />
              Variants ({snapshot.variants.length})
            </h3>
            {snapshot.variants.length > 0 ? (
              <div className="rounded-xl border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Variant</th>
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">SKU</th>
                      {item.variant_dimensions?.map((dim: string) => (
                        <th key={dim} className="px-4 py-2.5 text-left font-medium text-muted-foreground capitalize">{dim}</th>
                      ))}
                      <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">On Hand</th>
                      <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Reserved</th>
                      <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Available</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.variants.map((v) => (
                      <tr key={v.variant_id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2.5">
                          <button
                            onClick={() => router.push(`/inventory/items/${v.variant_id}`)}
                            className="font-medium text-foreground hover:text-primary hover:underline text-left"
                          >
                            {v.variant_name}
                          </button>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs">{v.variant_sku}</td>
                        {item.variant_dimensions?.map((dim: string) => (
                          <td key={dim} className="px-4 py-2.5">{v.variant_attributes?.[dim] ?? '-'}</td>
                        ))}
                        <td className="px-4 py-2.5 text-right font-mono">{formatQty(v.on_hand)}</td>
                        <td className="px-4 py-2.5 text-right font-mono">{formatQty(v.reserved)}</td>
                        <td className="px-4 py-2.5 text-right font-mono">
                          <span className={Number(v.available) <= 0 ? 'text-red-600 font-semibold' : ''}>
                            {formatQty(v.available)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                No variants created yet.
              </div>
            )}
          </div>
        )}

        {/* Parent link for variant children */}
        {item.parent_item_id && (
          <div className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-3">
            <p className="text-sm text-violet-800">
              This is a variant.{' '}
              <button
                onClick={() => router.push(`/inventory/items/${item.parent_item_id}`)}
                className="font-medium text-violet-700 hover:underline"
              >
                View parent item
              </button>
            </p>
            {item.variant_attributes && (
              <div className="mt-1 flex gap-2">
                {Object.entries(item.variant_attributes).map(([k, v]) => (
                  <span key={k} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-violet-200 text-violet-800 capitalize">
                    {k}: {String(v)}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Stock by Location */}
        <div>
          <h3 className="mb-3 flex items-center gap-2 text-base font-semibold">
            <MapPin className="h-4 w-4" />
            Stock by Location
          </h3>
          {snapshot.locations.length > 0 ? (
            <DataTable
              data={snapshot.locations}
              columns={locationColumns}
              rowKey={(row) => row.location_id}
            />
          ) : (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No stock ledger entries yet. Adjust stock or receive inventory to see location data.
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
