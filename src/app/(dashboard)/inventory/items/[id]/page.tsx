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
  UserCheck,
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
import {
  AdjustStockModal,
  type AdjustStockForm,
  type GuardrailBlock,
} from '@/components/inventory/AdjustStockModal';
import { AssetAssignModal } from '@/components/inventory/AssetAssignModal';

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
  // Amazon product link, derived from this item's Amazon mapping and surfaced as
  // a read-only pinned entry inside Reference Links.
  const [amazonLink, setAmazonLink] = useState<{ asin: string; url: string } | null>(null);

  // Adjust-stock modal (opened in-place from this item's page so there's no
  // dead-end trip to Stock Balances for an item that has no balance yet).
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [adjustForm, setAdjustForm] = useState<AdjustStockForm>({
    catalog_item_id: '',
    variant_item_id: '',
    location_id: '',
    new_qty: '',
    reason: '',
    notes: '',
    override_reason: '',
  });
  const [adjustLocations, setAdjustLocations] = useState<Array<{ id: string; name: string }>>([]);
  const [adjustSaving, setAdjustSaving] = useState(false);
  const [adjustError, setAdjustError] = useState('');
  const [guardrailBlock, setGuardrailBlock] = useState<GuardrailBlock>(null);

  // Serialized units of this item + who currently has each one, managed here
  // (assign/return/label) so identification lives on the item page.
  type ItemUnit = Awaited<ReturnType<typeof InventoryRPC.getAssets>>[number];
  type UnitAssignment = Awaited<ReturnType<typeof InventoryRPC.getOpenAssetAssignments>>[number];
  const [units, setUnits] = useState<ItemUnit[]>([]);
  const [unitAssignments, setUnitAssignments] = useState<Record<string, UnitAssignment>>({});
  const [assignmentTypes, setAssignmentTypes] = useState<Awaited<ReturnType<typeof InventoryRPC.getAssignmentTypes>>>([]);
  const [assignTarget, setAssignTarget] = useState<ItemUnit | null>(null);
  const [unitLabelBatch, setUnitLabelBatch] = useState<Array<{ code: string; label: string; kind: 'individual' }> | null>(null);

  const loadUnits = async () => {
    try {
      const assets = await InventoryRPC.getAssets({ catalog_item_id: params.id });
      setUnits(assets);
      const open = await InventoryRPC.getOpenAssetAssignments(assets.map((a) => a.id));
      const byAsset: Record<string, UnitAssignment> = {};
      for (const a of open) if (!byAsset[a.asset_id]) byAsset[a.asset_id] = a;
      setUnitAssignments(byAsset);
    } catch (err) {
      console.error('Error loading units:', err);
    }
  };

  // History — recent stock movements for this item (the audit trail, item-first).
  type ItemMovement = Awaited<ReturnType<typeof InventoryRPC.getStockMovements>>[number];
  const [history, setHistory] = useState<ItemMovement[]>([]);
  const loadHistory = async () => {
    try {
      const rows = await InventoryRPC.getStockMovements({ catalog_item_id: params.id });
      setHistory(rows.slice(0, 12));
    } catch (err) {
      console.error('Error loading history:', err);
    }
  };

  // Active reservations on this item — where they're held and who they're for.
  type ItemReservation = Awaited<ReturnType<typeof InventoryRPC.getReservations>>[number];
  const [reservations, setReservations] = useState<ItemReservation[]>([]);
  const loadReservations = async () => {
    try {
      const rows = await InventoryRPC.getReservations({ status: 'active', catalog_item_id: params.id });
      setReservations(rows);
    } catch (err) {
      console.error('Error loading reservations:', err);
    }
  };

  /** Who/what a reservation is for — job_ref is free text for manual holds,
   *  a structured object for mirrored ones (e.g. Operations equipment holds). */
  const reservationFor = (r: ItemReservation): { text: string; source: string | null } => {
    const ref = r.job_ref as Record<string, unknown> | string | null;
    if (!ref) return { text: r.external_order_ref || '—', source: null };
    if (typeof ref === 'string') return { text: ref, source: null };
    return {
      text: String(ref.job_name || ref.job_id || ref.name || ref.ref || r.external_order_ref || '—'),
      source: ref.source ? String(ref.source) : null,
    };
  };

  const reloadSnapshot = async () => {
    const fresh = await InventoryRPC.getItemStockSnapshot(params.id);
    setSnapshot(fresh);
  };

  // Lazy-load locations the first time the adjust modal opens.
  useEffect(() => {
    if (!showAdjustModal || adjustLocations.length > 0) return;
    (async () => {
      try {
        const locations = await InventoryRPC.getLocations({ active: true });
        setAdjustLocations((locations || []).map((loc) => ({ id: loc.id, name: loc.name })));
      } catch (err) {
        console.error('Error loading locations:', err);
      }
    })();
  }, [showAdjustModal, adjustLocations.length]);

  const openAdjustModal = () => {
    if (!snapshot?.item) return;
    setAdjustError('');
    setGuardrailBlock(null);
    setAdjustForm({
      catalog_item_id: snapshot.item.id,
      variant_item_id: '',
      location_id: '',
      new_qty: '',
      reason: '',
      notes: '',
      override_reason: '',
    });
    setShowAdjustModal(true);
  };

  const submitAdjustment = async () => {
    setAdjustError('');
    setGuardrailBlock(null);
    const selected = snapshot?.item;
    // A parent (variant) item can't hold stock itself — the modal resolves which
    // child to write into variant_item_id.
    const targetItemId = selected?.is_parent ? adjustForm.variant_item_id : adjustForm.catalog_item_id;
    if (!targetItemId || !adjustForm.location_id) {
      setAdjustError(selected?.is_parent ? 'Select a variant and location.' : 'Select a location.');
      return;
    }
    const qty = Number(adjustForm.new_qty);
    if (!Number.isFinite(qty)) {
      setAdjustError('Enter a valid quantity.');
      return;
    }
    if (!adjustForm.reason) {
      setAdjustError('Select a reason for this adjustment.');
      return;
    }

    setAdjustSaving(true);
    try {
      const result = await InventoryRPC.adjustInventory({
        catalog_item_id: targetItemId,
        location_id: adjustForm.location_id,
        new_qty: qty,
        reason: adjustForm.reason as 'count_variance' | 'damage' | 'theft' | 'expiration' | 'other',
        notes: adjustForm.notes,
        override_reason: adjustForm.override_reason || undefined,
      });

      if (!result.success && result.error) {
        setGuardrailBlock(result.error);
        return;
      }

      if (result.override_logged) {
        alert('Adjustment saved. Override has been logged for audit.');
      }

      setShowAdjustModal(false);
      setGuardrailBlock(null);
      await reloadSnapshot();
    } catch (err: any) {
      setAdjustError(err?.message || 'Failed to adjust inventory.');
    } finally {
      setAdjustSaving(false);
    }
  };

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
        // Units, reservations, history + assignment types load after the main snapshot (non-blocking).
        void loadUnits();
        void loadReservations();
        void loadHistory();
        InventoryRPC.getAssignmentTypes().then(setAssignmentTypes).catch(() => {});
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
        {/* Header */}
        <div>
          <div className="flex items-start gap-4">
            <EntityImageUpload
              entityType="catalog_item"
              entityId={params.id}
              size="lg"
              generateContext={{ name: item.name, description: (item as any).description || '' }}
            />
            <div className="flex-1 min-w-0">
              <PageHeader
                backHref="/inventory/items"
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
            onClick={openAdjustModal}
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

        {/* Units & who has them — serialized assets of this item, managed here */}
        {units.length > 0 && (
          <div className="rounded-xl border bg-background p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-base font-semibold">
                <UserCheck className="h-4 w-4" />
                Units &amp; Who Has Them ({units.length})
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() =>
                    setUnitLabelBatch(units.map((u) => ({
                      code: u.asset_tag,
                      label: `${item.name}${u.serial_number ? ` · SN ${u.serial_number}` : ''}`,
                      kind: 'individual' as const,
                    })))
                  }
                  className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
                >
                  <Printer className="h-3.5 w-3.5" /> Print All Labels
                </button>
                <button
                  onClick={() => router.push('/inventory/assets')}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Open Assets →
                </button>
              </div>
            </div>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Asset Tag</th>
                    <th className="px-4 py-2.5 font-medium">Serial #</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium">Location</th>
                    <th className="px-4 py-2.5 font-medium">Assigned To</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {units.map((u) => {
                    const liveStatus = u.asset_state?.current_status || u.status || 'available';
                    const assignment = unitAssignments[u.id];
                    const typeLabel = assignment
                      ? assignmentTypes.find((t) => t.type_key === assignment.assigned_to_type)?.display_name
                        || assignment.assigned_to_type
                      : null;
                    return (
                      <tr key={u.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2.5 font-mono text-xs font-medium">{u.asset_tag}</td>
                        <td className="px-4 py-2.5 font-mono text-xs">{u.serial_number || '—'}</td>
                        <td className="px-4 py-2.5"><StatusChip status={liveStatus} /></td>
                        <td className="px-4 py-2.5">{u.location?.name || '—'}</td>
                        <td className="px-4 py-2.5">
                          {assignment ? (
                            <div>
                              <span className="font-medium">{assignment.assigned_to_id}</span>
                              <span className="ml-1.5 rounded-full bg-blue-50 px-1.5 py-px text-[10px] font-medium text-blue-700">
                                {typeLabel}
                              </span>
                              <div className="text-[11px] text-muted-foreground">
                                since {new Date(assignment.assigned_at).toLocaleDateString()}
                              </div>
                            </div>
                          ) : liveStatus === 'assigned' ? (
                            <span className="text-muted-foreground">assigned (no record)</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          <button
                            onClick={() => setAssignTarget(u)}
                            className={`rounded px-2 py-1 text-xs font-medium ${
                              liveStatus === 'assigned'
                                ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                                : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                            }`}
                          >
                            {liveStatus === 'assigned' ? 'Return' : 'Assign'}
                          </button>
                          <button
                            onClick={() =>
                              setUnitLabelBatch([{
                                code: u.asset_tag,
                                label: `${item.name}${u.serial_number ? ` · SN ${u.serial_number}` : ''}`,
                                kind: 'individual' as const,
                              }])
                            }
                            className="ml-2 rounded bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                          >
                            Label
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Active reservations — where this item is held, and for who */}
        {reservations.length > 0 && (
          <div className="rounded-xl border bg-background p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-base font-semibold">
                <CalendarCheck className="h-4 w-4" />
                Active Reservations ({reservations.length})
              </h3>
              <button
                onClick={() => router.push(`/inventory/reservations?item_id=${params.id}`)}
                className="text-xs font-medium text-primary hover:underline"
              >
                Open Reservations →
              </button>
            </div>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Qty / Unit</th>
                    <th className="px-4 py-2.5 font-medium">Where</th>
                    <th className="px-4 py-2.5 font-medium">For</th>
                    <th className="px-4 py-2.5 font-medium">When</th>
                  </tr>
                </thead>
                <tbody>
                  {reservations.map((r) => {
                    const who = reservationFor(r);
                    const window = r.reserved_from
                      ? `${new Date(r.reserved_from).toLocaleDateString()}${r.reserved_until ? ` → ${new Date(r.reserved_until).toLocaleDateString()}` : ''}`
                      : r.needed_by
                        ? `needed by ${new Date(r.needed_by).toLocaleDateString()}`
                        : '—';
                    return (
                      <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-2.5">
                          <span className="font-mono font-medium">{formatQty(Number(r.qty))}</span>
                          {(r as any).assets?.asset_tag && (
                            <span className="ml-2 font-mono text-xs text-muted-foreground">
                              {(r as any).assets.asset_tag}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">{(r as any).locations?.name || '—'}</td>
                        <td className="px-4 py-2.5">
                          <span className="font-medium">{who.text}</span>
                          {who.source && (
                            <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-px text-[10px] font-medium text-slate-600">
                              {who.source}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">{window}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

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
            pinnedLinks={amazonLink ? [{ label: 'Amazon', url: amazonLink.url, hint: amazonLink.asin }] : []}
          />
        </div>

        {/* Amazon ordering link for this item */}
        <ItemAmazonMapping catalogItemId={params.id} onMappingChange={setAmazonLink} />

        {/* Scanner overlay */}
        <BarcodeScannerOverlay
          isOpen={scannerOpen}
          onClose={() => setScannerOpen(false)}
          onScan={handleScanBarcode}
        />

        {/* Label print dialog */}
        {showLabelDialog && (
          <BarcodeLabelDialog
            items={[{ code: barcode || item.sku, label: item.name, kind: 'stock' }]}
            entityType="item"
            onClose={() => setShowLabelDialog(false)}
          />
        )}

        {/* Unit label print dialog (asset tags — one per physical unit) */}
        {unitLabelBatch && (
          <BarcodeLabelDialog
            items={unitLabelBatch}
            entityType="asset"
            onClose={() => setUnitLabelBatch(null)}
          />
        )}

        {/* Assign / return a unit without leaving the item page */}
        {assignTarget && (
          <AssetAssignModal
            asset={assignTarget}
            assignmentTypes={assignmentTypes}
            onClose={() => setAssignTarget(null)}
            onComplete={() => { setAssignTarget(null); void loadUnits(); }}
          />
        )}

        {/* History — recent movements for this item (folded from the Movements page) */}
        {history.length > 0 && (
          <div className="rounded-xl border bg-background p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-base font-semibold">
                <Clock className="h-4 w-4" />
                History
              </h3>
              <button
                onClick={() => router.push(`/inventory/movements?item=${params.id}`)}
                className="text-xs font-medium text-primary hover:underline"
              >
                Full history →
              </button>
            </div>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">When</th>
                    <th className="px-4 py-2.5 font-medium">What</th>
                    <th className="px-4 py-2.5 font-medium">Where</th>
                    <th className="px-4 py-2.5 text-right font-medium">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((m) => (
                    <tr key={m.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                        {new Date(m.occurred_at || m.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </td>
                      <td className="px-4 py-2 capitalize">{String(m.movement_type || '').replace(/_/g, ' ')}</td>
                      <td className="px-4 py-2">{(m as any).locations?.name || '—'}</td>
                      <td className={`px-4 py-2 text-right font-mono ${Number(m.quantity_delta) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {Number(m.quantity_delta) >= 0 ? '+' : ''}{Number(m.quantity_delta).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
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
      {showAdjustModal && snapshot?.item && (
        <AdjustStockModal
          form={adjustForm}
          items={[{
            id: snapshot.item.id,
            name: snapshot.item.name,
            sku: snapshot.item.sku,
            is_parent: snapshot.item.is_parent,
            variant_dimensions: snapshot.item.variant_dimensions,
            variant_options: snapshot.item.variant_options,
          }]}
          locations={adjustLocations}
          saving={adjustSaving}
          error={adjustError}
          guardrailBlock={guardrailBlock}
          lockItem
          onClose={() => { setShowAdjustModal(false); setGuardrailBlock(null); }}
          onChange={(next) => { setAdjustForm((prev) => ({ ...prev, ...next })); setGuardrailBlock(null); }}
          onSubmit={submitAdjustment}
          onBatchComplete={async (allSucceeded) => {
            await reloadSnapshot();
            if (allSucceeded) {
              setShowAdjustModal(false);
              setGuardrailBlock(null);
            }
          }}
        />
      )}
    </AppShell>
  );
}
