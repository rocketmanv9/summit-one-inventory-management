'use client';

import { AppError } from '@rocketmanv9/chassis/errors';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/FilterBar';
import { StatusChip } from '@/components/ui/StatusChip';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { BarcodeLabelDialog } from '@/components/modals/BarcodeLabelDialog';
import type { BarcodeLabelItem } from '@/components/modals/BarcodeLabelDialog';
import { consumePendingLabelBatch, PENDING_LABEL_BATCH_EVENT } from '@/lib/labels/pending-batch';
import { useEntityImages } from '@/hooks/useEntityImages';
import { EntityImageThumbnail } from '@/components/ui/EntityImageThumbnail';
import { EntityImageUpload } from '@/components/ui/EntityImageUpload';
import { AssetTransferModal } from '@/components/assets/AssetTransferModal';
import { CreateAssetModal } from '@/components/assets/CreateAssetModal';
import { AssetTypeClassFields } from '@/components/assets/AssetTypeClassFields';
import { useGVLabelMap } from '@/hooks/useGVTerms';
import { useEquipmentClassMap } from '@/hooks/useEquipmentClasses';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { AssetAssignModal } from '@/components/inventory/AssetAssignModal';
import { HowItWorksCard, HowThisWorksButton, useHowItWorks } from '@/components/ui/HowItWorksCard';
import { Tag, QrCode, UserCheck, ArrowLeftRight } from 'lucide-react';
import type { Database } from 'types/supabase';

type AssetRow = Database['inventory']['Tables']['assets']['Row'];
type CatalogItemRow = Database['inventory']['Tables']['catalog_items']['Row'];
type LocationRow = Database['inventory']['Tables']['locations']['Row'];
type LocationTypeRow = Database['inventory']['Tables']['location_types']['Row'];
type AssetStateRow = Database['inventory']['Tables']['asset_state']['Row'];
type CatalogItemOption = Pick<CatalogItemRow, 'id' | 'name' | 'sku'>;

type AssignmentTypeRow = {
  id: string;
  type_key: string;
  display_name: string;
  description: string | null;
  is_active: boolean;
  sort_order: number | null;
  last_event_id: string | null;
};

type Asset = {
  id: string;
  asset_tag: string;
  serial_number: string | null;
  asset_kind?: string | null;
  asset_type_term_id?: string | null;
  equipment_class_id?: string | null;
  make?: string | null;
  model?: string | null;
  model_year?: number | null;
  catalog_item_id: string | null;
  location_id: string | null;
  status: string | null;
  purchase_date: string | null;
  purchase_cost: number | null;
  warranty_expires: string | null;
  last_event_id: string | null;
  catalog_item?: Pick<CatalogItemRow, 'id' | 'name' | 'sku'> | null;
  location?: (LocationRow & {
    location_type?: { id?: string; name?: string } | null;
  }) | null;
  asset_state?: Pick<AssetStateRow, 'current_status' | 'current_location_id'> | null;
};

export default function AssetsPage() {
  const help = useHowItWorks('inventory-assets-help');
  const router = useRouter();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [assignmentTypes, setAssignmentTypes] = useState<AssignmentTypeRow[]>([]);
  const [barcodeItems, setBarcodeItems] = useState<BarcodeLabelItem[] | null>(null);
  const [barcodeWarning, setBarcodeWarning] = useState<string | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<Asset | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const assetIds = assets.map(a => a.id);
  const { imageMap } = useEntityImages('asset', assetIds);

  // GV label maps for the Type column. Term ids are unique across domains, so the
  // three type domains merge cleanly into one term_id → label lookup.
  const vehicleTypeMap = useGVLabelMap('vehicle_type');
  const equipmentTypeMap = useGVLabelMap('equipment_type');
  const toolTypeMap = useGVLabelMap('tool_type');
  const equipmentClassMap = useEquipmentClassMap();
  const typeLabel = (termId?: string | null) =>
    (termId && (vehicleTypeMap[termId] || equipmentTypeMap[termId] || toolTypeMap[termId])) || null;

  useEffect(() => {
    fetchAssets();
    fetchAssignmentTypes();
  }, [filters]);

  // Label batches queued by Isabelle (print_labels tool): consume on mount for
  // the navigated-here case, and on the event for the already-on-this-page case.
  useEffect(() => {
    const openPendingBatch = () => {
      const batch = consumePendingLabelBatch();
      if (!batch) return;
      setBarcodeWarning(batch.warning);
      setBarcodeItems(batch.items);
    };
    openPendingBatch();
    window.addEventListener(PENDING_LABEL_BATCH_EVENT, openPendingBatch);
    return () => window.removeEventListener(PENDING_LABEL_BATCH_EVENT, openPendingBatch);
  }, []);

  const resolveStatus = (asset: Asset) => asset.asset_state?.current_status || asset.status || 'available';

  const fetchAssets = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.status) params.set('status', filters.status);
      if (filters.assigned === 'true') params.set('assigned', 'true');

      const data = await InventoryRPC.getAssets({
        status: filters.status || undefined,
        assigned: filters.assigned === 'true' ? true : undefined,
      });
      setAssets(data || []);
    } catch (error) {
      console.error('Error fetching assets:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchAssignmentTypes = async () => {
    try {
      const data = await InventoryRPC.getAssignmentTypes();
      setAssignmentTypes(data || []);
    } catch (error) {
      console.error('Error fetching assignment types:', error);
    }
  };

  const handleDeleteAsset = (asset: Asset) => {
    setDeleteError('');
    setDeleteTarget(asset);
  };

  const confirmDeleteAsset = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError('');

    try {
      if (!deleteTarget.last_event_id) {
        setDeleteError('Missing last_event_id. Please refresh and try again.');
        return;
      }

      await InventoryRPC.deleteAsset(deleteTarget.id, deleteTarget.last_event_id);

      setDeleteTarget(null);
      await fetchAssets();
    } catch (error) {
      console.error('Error deleting asset:', error);
      setDeleteError('Failed to delete asset');
    } finally {
      setDeleting(false);
    }
  };

  const columns = [
    {
      key: 'photo',
      header: '',
      className: 'w-10',
      render: (row: Asset) => (
        <EntityImageThumbnail url={imageMap[row.id]} alt={row.asset_tag} />
      ),
    },
    {
      key: 'asset_tag',
      header: 'Asset Tag',
      sortable: true,
      render: (row: Asset) => (
        <Link
          href={`/inventory/assets/${row.id}`}
          className="font-mono font-medium text-foreground hover:text-primary hover:underline"
        >
          {row.asset_tag}
        </Link>
      ),
    },
    {
      key: 'asset_kind',
      header: 'Type',
      sortable: true,
      render: (row: Asset) => {
        if (!row.asset_kind) return <span className="text-xs text-muted-foreground">—</span>;
        const styles: Record<string, string> = {
          vehicle: 'bg-blue-100 text-blue-800',
          equipment: 'bg-amber-100 text-amber-800',
          tool: 'bg-emerald-100 text-emerald-800',
          other: 'bg-gray-100 text-gray-700',
        };
        const tLabel = typeLabel(row.asset_type_term_id);
        const cLabel = row.equipment_class_id ? equipmentClassMap[row.equipment_class_id] : null;
        return (
          <div className="space-y-0.5">
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${styles[row.asset_kind] || 'bg-gray-100 text-gray-700'}`}>
              {row.asset_kind}
            </span>
            {tLabel && <div className="text-xs text-muted-foreground">{tLabel}</div>}
            {cLabel && <div className="text-xs text-muted-foreground">{cLabel}</div>}
          </div>
        );
      },
    },
    {
      key: 'item',
      header: 'Item',
      sortable: true,
      render: (row: Asset) => {
        const makeModel = [row.make, row.model].filter(Boolean).join(' ');
        return (
          <div>
            <div className="font-medium">{row.catalog_item?.name || makeModel || '-'}</div>
            <div className="text-xs text-muted-foreground">
              {row.catalog_item?.sku || [makeModel && row.catalog_item?.name ? makeModel : '', row.model_year].filter(Boolean).join(' · ') || ''}
            </div>
          </div>
        );
      },
    },
    {
      key: 'serial_number',
      header: 'Serial Number',
      render: (row: Asset) => (
        <span className="font-mono text-sm">{row.serial_number || '-'}</span>
      ),
    },
    {
      key: 'location',
      header: 'Location',
      render: (row: Asset) => (
        <div>
          <div>{row.location?.name || '-'}</div>
          {row.location?.location_type?.name && (
            <div className="text-xs text-muted-foreground">{row.location.location_type.name}</div>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: Asset) => (
        <StatusChip status={resolveStatus(row)} />
      ),
    },
    {
      key: 'warranty',
      header: 'Warranty',
      render: (row: Asset) => {
        if (!row.warranty_expires) return '-';
        const expiresDate = new Date(row.warranty_expires);
        const isExpired = expiresDate < new Date();
        return (
          <span className={isExpired ? 'text-red-600' : ''}>
            {expiresDate.toLocaleDateString()}
          </span>
        );
      },
    },
    {
      key: 'actions',
      header: '',
      render: (row: Asset) => (
        <div className="flex gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              // Re-printing for an already-placed unit is a common source of
              // duplicate tags — say where it lives before more labels print.
              const locName = (row as any).location?.name ?? (row as any).locations?.name ?? null;
              const placed: string[] = [];
              if (row.asset_tag) placed.push(`already tagged ${row.asset_tag}`);
              if (locName) placed.push(`located at ${locName}`);
              if (row.status && !['available', 'active'].includes(String(row.status).toLowerCase())) {
                placed.push(`status "${row.status}"`);
              }
              setBarcodeWarning(
                placed.length > 1
                  ? `This unit is ${placed.join(', ')}. Printing another label can create duplicates — reuse the existing tag unless it's lost or damaged.`
                  : undefined,
              );
              setBarcodeItems([{
                code: row.asset_tag,
                label: `${row.asset_tag}${row.catalog_item?.name ? ` - ${row.catalog_item.name}` : ''}`,
                kind: 'individual',
              }]);
            }}
            className="px-2 py-1 text-xs bg-purple-100 text-purple-800 rounded hover:bg-purple-200"
          >
            Barcode
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setSelectedAsset(row);
              setShowEditModal(true);
            }}
            className="px-2 py-1 text-xs bg-gray-100 text-gray-800 rounded hover:bg-gray-200"
          >
            Edit
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setSelectedAsset(row);
              setShowAssignModal(true);
            }}
            className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded hover:bg-blue-200"
          >
            {row.status === 'assigned' ? 'Return' : 'Assign'}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setSelectedAsset(row);
              setShowTransferModal(true);
            }}
            className="px-2 py-1 text-xs bg-teal-100 text-teal-800 rounded hover:bg-teal-200"
          >
            Transfer
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDeleteAsset(row);
            }}
            className="px-2 py-1 text-xs bg-red-100 text-red-800 rounded hover:bg-red-200"
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  const filterConfig = [
    {
      key: 'kind',
      label: 'Type',
      type: 'select' as const,
      options: [
        { value: 'vehicle', label: 'Vehicles' },
        { value: 'equipment', label: 'Equipment' },
        { value: 'tool', label: 'Tools' },
        { value: 'other', label: 'Other' },
        { value: 'unclassified', label: 'Unclassified' },
      ],
    },
    {
      key: 'status',
      label: 'Status',
      type: 'select' as const,
      options: [
        { value: 'available', label: 'Available' },
        { value: 'assigned', label: 'Assigned' },
        { value: 'maintenance', label: 'Maintenance' },
        { value: 'retired', label: 'Retired' },
      ],
    },
    {
      key: 'search',
      label: 'Search',
      type: 'search' as const,
      placeholder: 'Asset tag or serial...',
    },
  ];

  const filteredAssets = assets.filter((asset) => {
    if (filters.kind) {
      // "unclassified" matches assets with no asset_kind set.
      if (filters.kind === 'unclassified' ? !!asset.asset_kind : asset.asset_kind !== filters.kind) {
        return false;
      }
    }
    if (filters.search) {
      const search = filters.search.toLowerCase();
      if (!asset.asset_tag.toLowerCase().includes(search) &&
          !(asset.serial_number?.toLowerCase().includes(search))) {
        return false;
      }
    }
    return true;
  });

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Assets"
          description="Track serialized assets and their assignments. Example: Manage equipment like Paver #1 (VIN: ABC123), Roller #3 (Serial: XYZ789), or GPS units assigned to specific trucks and operators, tracking who has what and when it's returned."
          actions={
            <>
              {!help.show && <HowThisWorksButton onClick={help.open} />}
              <div className="flex gap-2">
                {filteredAssets.length > 0 && (
                  <button
                    onClick={() => {
                      setBarcodeItems(filteredAssets.map(a => ({
                        code: a.asset_tag,
                        label: `${a.asset_tag}${a.catalog_item?.name ? ` - ${a.catalog_item.name}` : ''}`,
                      })));
                    }}
                    className="px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50 transition-colors"
                  >
                    Print Barcodes ({filteredAssets.length})
                  </button>
                )}
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
                >
                  + Add Asset
                </button>
              </div>
            </>
          }
        />

        {help.show && (
          <HowItWorksCard
            title="How assets work"
            onDismiss={help.dismiss}
            steps={[
              { title: 'Add each unit once', body: 'Every serialized unit gets its own record with an asset tag and serial number — optionally linked to a catalog item and classified as a vehicle, equipment, or tool so it syncs with Fleet.' },
              { title: 'Tag it with a barcode', body: 'Print a barcode label per unit (or a whole filtered batch) so it can be scanned in the field. Re-printing warns you if the unit is already tagged and placed, to avoid duplicates.' },
              { title: 'Assign, return, transfer', body: 'Check a unit out to an employee, crew, job, or yard. On return, the condition you pick sets the next status — good goes back to available, damaged goes to maintenance. Transfer moves it between locations.' },
              { title: 'Track the whole lifecycle', body: 'Status, location, purchase cost, and warranty live on each record — expired warranties show in red. Click an asset tag for its full history.' },
            ]}
            legend={[
              { badge: <span className="rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-xs font-medium">Available</span>, text: 'in the yard, ready to assign' },
              { badge: <span className="rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 text-xs font-medium">Assigned</span>, text: 'checked out to a person, crew, or job' },
              { badge: <span className="rounded-full bg-orange-100 text-orange-700 px-2 py-0.5 text-xs font-medium">Maintenance</span>, text: 'being repaired — returned damaged or flagged' },
              { badge: <span className="rounded-full bg-gray-100 text-gray-700 px-2 py-0.5 text-xs font-medium">Retired</span>, text: 'out of service for good' },
            ]}
            glossary={[
              { Icon: Tag, term: 'Asset tag', blurb: 'your unique ID for one physical unit — what gets printed on the barcode and scanned everywhere' },
              { Icon: QrCode, term: 'Barcode', blurb: 'a printable scan label per unit; print in bulk from the header for everything currently filtered' },
              { Icon: UserCheck, term: 'Assign / Return', blurb: 'checkout and check-in — the return condition decides whether the unit goes to available, maintenance, or out of service' },
              { Icon: ArrowLeftRight, term: 'Transfer', blurb: 'moves a unit between locations (yards, trucks, job sites) without changing who it is assigned to' },
            ]}
          />
        )}


        <div className="grid grid-cols-4 gap-4">
          <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="text-2xl font-bold text-green-700">
              {assets.filter(a => resolveStatus(a) === 'available').length}
            </div>
            <div className="text-sm text-green-600">Available</div>
          </div>
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="text-2xl font-bold text-blue-700">
              {assets.filter(a => resolveStatus(a) === 'assigned').length}
            </div>
            <div className="text-sm text-blue-600">Assigned</div>
          </div>
          <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg">
            <div className="text-2xl font-bold text-orange-700">
              {assets.filter(a => resolveStatus(a) === 'maintenance').length}
            </div>
            <div className="text-sm text-orange-600">In Maintenance</div>
          </div>
          <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
            <div className="text-2xl font-bold text-gray-700">
              {assets.filter(a => resolveStatus(a) === 'retired').length}
            </div>
            <div className="text-sm text-gray-600">Retired</div>
          </div>
        </div>

        <FilterBar
          filters={filterConfig}
          values={filters}
          onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
          onClear={() => setFilters({})}
        />

        <DataTable
          data={filteredAssets}
          columns={columns}
          loading={loading}
          emptyMessage="No assets found"
          rowKey={(row) => row.id}
          onRowClick={(row) => router.push(`/inventory/assets/${row.id}`)}
        />

        {showCreateModal && (
          <CreateAssetModal
            onClose={() => setShowCreateModal(false)}
            onComplete={() => {
              setShowCreateModal(false);
              fetchAssets();
            }}
          />
        )}

        {showAssignModal && selectedAsset && (
          <AssetAssignModal
            asset={selectedAsset}
            assignmentTypes={assignmentTypes}
            onClose={() => {
              setShowAssignModal(false);
              setSelectedAsset(null);
            }}
            onComplete={() => {
              setShowAssignModal(false);
              setSelectedAsset(null);
              fetchAssets();
            }}
          />
        )}

        {showTransferModal && selectedAsset && (
          <AssetTransferModal
            asset={selectedAsset}
            onClose={() => {
              setShowTransferModal(false);
              setSelectedAsset(null);
            }}
            onComplete={() => {
              setShowTransferModal(false);
              setSelectedAsset(null);
              fetchAssets();
            }}
          />
        )}

        {barcodeItems && (
          <BarcodeLabelDialog
            items={barcodeItems}
            entityType="asset"
            warning={barcodeWarning}
            onClose={() => {
              setBarcodeItems(null);
              setBarcodeWarning(undefined);
            }}
          />
        )}

        {showEditModal && selectedAsset && (
          <EditAssetModal
            asset={selectedAsset}
            onClose={() => {
              setShowEditModal(false);
              setSelectedAsset(null);
            }}
            onComplete={() => {
              setShowEditModal(false);
              setSelectedAsset(null);
              fetchAssets();
            }}
          />
        )}

        {/* Delete asset confirmation */}
        <ConfirmDialog
          open={!!deleteTarget}
          title="Delete asset"
          message={deleteTarget ? `Delete asset ${deleteTarget.asset_tag}? This cannot be undone.` : ''}
          confirmLabel="Delete"
          loadingLabel="Deleting..."
          destructive
          loading={deleting}
          error={deleteError}
          onConfirm={confirmDeleteAsset}
          onCancel={() => { setDeleteTarget(null); setDeleteError(''); }}
        />
      </div>
    </AppShell>
  );
}

function EditAssetModal({ 
  asset, 
  onClose, 
  onComplete 
}: { 
  asset: Asset; 
  onClose: () => void; 
  onComplete: () => void;
}) {
  const [catalogItems, setCatalogItems] = useState<CatalogItemOption[]>([]);
  const [locations, setLocations] = useState<(LocationRow & { location_type?: Pick<LocationTypeRow, 'name'> | null })[]>([]);
  const [form, setForm] = useState({
    catalog_item_id: asset.catalog_item_id || '',
    asset_tag: asset.asset_tag,
    serial_number: asset.serial_number || '',
    location_id: asset.location_id || '',
    purchase_date: asset.purchase_date || '',
    purchase_cost: asset.purchase_cost?.toString() || '',
    warranty_expires: asset.warranty_expires || '',
    asset_kind: asset.asset_kind || '',
    asset_type_term_id: asset.asset_type_term_id || '',
    equipment_class_id: asset.equipment_class_id || '',
    make: asset.make || '',
    model: asset.model || '',
    model_year: asset.model_year?.toString() || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Changing the fleet kind invalidates the GV type/class (different domains).
  const setAssetKind = (asset_kind: string) =>
    setForm((f) => ({ ...f, asset_kind, asset_type_term_id: '', equipment_class_id: '' }));

  useEffect(() => {
    fetchCatalogItems();
    fetchLocations();
  }, []);

  const fetchCatalogItems = async () => {
    try {
      const data = await InventoryRPC.getCatalogItems({ active: true });
      setCatalogItems(data || []);
    } catch (error) {
      console.error('Error fetching items:', error);
    }
  };

  const fetchLocations = async () => {
    try {
      const data = await InventoryRPC.getLocations();
      setLocations(data || []);
    } catch (error) {
      console.error('Error fetching locations:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      if (!asset.last_event_id) {
        throw AppError.badRequest('Missing last_event_id. Please refresh and try again.');
      }

      await InventoryRPC.updateAsset(
        asset.id,
        {
          catalog_item_id: form.catalog_item_id || null,
          asset_tag: form.asset_tag,
          serial_number: form.serial_number || null,
          location_id: form.location_id || null,
          purchase_date: form.purchase_date || null,
          purchase_cost: form.purchase_cost ? parseFloat(form.purchase_cost) : null,
          warranty_expires: form.warranty_expires || null,
          asset_kind: form.asset_kind || null,
          asset_type_term_id: form.asset_type_term_id || null,
          equipment_class_id: form.asset_kind === 'equipment' ? (form.equipment_class_id || null) : null,
          make: form.make.trim() || null,
          model: form.model.trim() || null,
          model_year: form.model_year ? parseInt(form.model_year, 10) : null,
        } as any,
        asset.last_event_id
      );

      onComplete();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-white">
          <h3 className="text-lg font-semibold">Edit Asset</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Catalog Item</label>
              <select
                value={form.catalog_item_id}
                onChange={(e) => setForm({ ...form, catalog_item_id: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">-- None --</option>
                {catalogItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.sku})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Fleet Type</label>
              <select
                value={form.asset_kind}
                onChange={(e) => setAssetKind(e.target.value)}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">Inventory only (don&apos;t sync)</option>
                <option value="equipment">Equipment</option>
                <option value="vehicle">Vehicle</option>
                <option value="tool">Tool</option>
              </select>
            </div>

            <AssetTypeClassFields
              assetKind={form.asset_kind}
              typeTermId={form.asset_type_term_id}
              classId={form.equipment_class_id}
              onTypeChange={(v) => setForm((f) => ({ ...f, asset_type_term_id: v }))}
              onClassChange={(v) => setForm((f) => ({ ...f, equipment_class_id: v }))}
            />

            <div>
              <label className="block text-sm font-medium mb-1">Make</label>
              <input
                type="text"
                value={form.make}
                onChange={(e) => setForm({ ...form, make: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="e.g. CAT"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Model</label>
              <input
                type="text"
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="e.g. 279D3"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Model Year</label>
              <input
                type="number"
                value={form.model_year}
                onChange={(e) => setForm({ ...form, model_year: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="e.g. 2022"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Asset Tag *</label>
              <input
                type="text"
                value={form.asset_tag}
                onChange={(e) => setForm({ ...form, asset_tag: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                required
                placeholder="ASSET-001"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Serial Number</label>
              <input
                type="text"
                value={form.serial_number}
                onChange={(e) => setForm({ ...form, serial_number: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="SN12345678"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Location</label>
              <select
                value={form.location_id}
                onChange={(e) => setForm({ ...form, location_id: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">-- None --</option>
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name} {loc.location_type?.name ? `(${loc.location_type.name})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Purchase Date</label>
              <input
                type="date"
                value={form.purchase_date}
                onChange={(e) => setForm({ ...form, purchase_date: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Purchase Cost</label>
              <input
                type="number"
                step="0.01"
                value={form.purchase_cost}
                onChange={(e) => setForm({ ...form, purchase_cost: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="0.00"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Warranty Expires</label>
              <input
                type="date"
                value={form.warranty_expires}
                onChange={(e) => setForm({ ...form, warranty_expires: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Update Asset'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
