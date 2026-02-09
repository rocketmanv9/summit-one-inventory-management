'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/FilterBar';
import { StatusChip } from '@/components/ui/StatusChip';
import { InventoryRPC } from '@/lib/rpc/inventory';
import type { Database } from 'types/supabase';

type AssetRow = Database['inventory']['Tables']['assets']['Row'];
type AssignmentTypeRow = Database['inventory']['Tables']['assignment_types']['Row'];
type CatalogItemRow = Database['inventory']['Tables']['catalog_items']['Row'];
type LocationRow = Database['inventory']['Tables']['locations']['Row'];
type LocationTypeRow = Database['inventory']['Tables']['location_types']['Row'];
type AssetStateRow = Database['inventory']['Tables']['asset_state']['Row'];

type Asset = AssetRow & {
  catalog_item?: Pick<CatalogItemRow, 'id' | 'name' | 'sku'> | null;
  location?: (LocationRow & {
    location_type?: Pick<LocationTypeRow, 'id' | 'name'> | null;
  }) | null;
  asset_state?: Pick<AssetStateRow, 'current_status' | 'current_location_id'> | null;
};

export default function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [assignmentTypes, setAssignmentTypes] = useState<AssignmentTypeRow[]>([]);

  useEffect(() => {
    fetchAssets();
    fetchAssignmentTypes();
  }, [filters]);

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

  const handleDeleteAsset = async (asset: Asset) => {
    if (!confirm(`Delete asset ${asset.asset_tag}? This cannot be undone.`)) {
      return;
    }

    try {
      if (!asset.last_event_id) {
        alert('Missing last_event_id. Please refresh and try again.');
        return;
      }

      await InventoryRPC.deleteAsset(asset.id, asset.last_event_id);

      await fetchAssets();
    } catch (error) {
      console.error('Error deleting asset:', error);
      alert('Failed to delete asset');
    }
  };

  const columns = [
    {
      key: 'asset_tag',
      header: 'Asset Tag',
      sortable: true,
      render: (row: Asset) => (
        <span className="font-mono font-medium">{row.asset_tag}</span>
      ),
    },
    {
      key: 'item',
      header: 'Item',
      sortable: true,
      render: (row: Asset) => (
        <div>
          <div className="font-medium">{row.catalog_item?.name || '-'}</div>
          <div className="text-xs text-muted-foreground">{row.catalog_item?.sku || ''}</div>
        </div>
      ),
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
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              + Add Asset
            </button>
          }
        />

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
      </div>
    </AppShell>
  );
}

function CreateAssetModal({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) {
  const [catalogItems, setCatalogItems] = useState<CatalogItemRow[]>([]);
  const [locations, setLocations] = useState<(LocationRow & { location_type?: Pick<LocationTypeRow, 'name'> | null })[]>([]);
  const [form, setForm] = useState({
    catalog_item_id: '',
    location_id: '',
    quantity: 1,
    asset_tag_prefix: '',
    serial_number_prefix: '',
    purchase_date: '',
    purchase_cost: '',
    warranty_expires: '',
  });
  const [useAutoNumbering, setUseAutoNumbering] = useState(true);
  const [customTags, setCustomTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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
      const quantity = parseInt(form.quantity.toString());
      let tagsToCreate: string[] = [];

      // Determine asset tags to create
      if (quantity === 1) {
        // Single asset - use the prefix as the full tag
        tagsToCreate = [form.asset_tag_prefix];
      } else if (useAutoNumbering) {
        // Auto-numbering mode
        for (let i = 1; i <= quantity; i++) {
          tagsToCreate.push(`${form.asset_tag_prefix}${String(i).padStart(3, '0')}`);
        }
      } else {
        // Custom tags mode - parse the textarea
        tagsToCreate = customTags
          .split('\n')
          .map(tag => tag.trim())
          .filter(tag => tag.length > 0);
        
        if (tagsToCreate.length !== quantity) {
          throw new Error(`Expected ${quantity} custom tags, but found ${tagsToCreate.length}`);
        }
      }
      
      // Create assets sequentially to ensure unique asset tags
      for (let i = 0; i < tagsToCreate.length; i++) {
        const assetData = {
          catalog_item_id: form.catalog_item_id,
          location_id: form.location_id || null,
          asset_tag: tagsToCreate[i],
          serial_number: (useAutoNumbering && quantity > 1 && form.serial_number_prefix)
            ? `${form.serial_number_prefix}${String(i + 1).padStart(3, '0')}`
            : form.serial_number_prefix || null,
          purchase_date: form.purchase_date || null,
          purchase_cost: form.purchase_cost ? parseFloat(form.purchase_cost) : null,
          warranty_expires: form.warranty_expires || null,
        };

        await InventoryRPC.createAsset({
          catalog_item_id: assetData.catalog_item_id || null,
          location_id: assetData.location_id,
          asset_tag: assetData.asset_tag,
          serial_number: assetData.serial_number,
          purchase_date: assetData.purchase_date,
          purchase_cost: assetData.purchase_cost,
          warranty_expires: assetData.warranty_expires,
          status: 'available',
        });
      }

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
          <h3 className="text-lg font-semibold">Create Asset(s)</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">Item Type *</label>
              <select
                value={form.catalog_item_id}
                onChange={(e) => setForm({ ...form, catalog_item_id: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                required
              >
                <option value="">Select item type...</option>
                {catalogItems.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.sku} - {item.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground mt-1">
                Example: "Leaf Blower Pro 3000" - you can create multiple individual assets from this
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Quantity *</label>
              <input
                type="number"
                min="1"
                max="100"
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: parseInt(e.target.value) || 1 })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                required
              />
              <p className="text-xs text-muted-foreground mt-1">
                Create multiple assets at once (e.g., 10 leaf blowers)
              </p>
            </div>

            <div className="col-span-2">
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium">
                  {parseInt(form.quantity.toString()) === 1 ? 'Asset Tag *' : 'Asset Tags *'}
                </label>
                {parseInt(form.quantity.toString()) > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      setUseAutoNumbering(!useAutoNumbering);
                      if (useAutoNumbering) {
                        // Switching to custom - pre-populate with auto-generated tags
                        const tags = Array.from({ length: parseInt(form.quantity.toString()) }, (_, i) => 
                          `${form.asset_tag_prefix}${String(i + 1).padStart(3, '0')}`
                        ).join('\n');
                        setCustomTags(tags);
                      }
                    }}
                    className="text-xs text-primary hover:underline"
                  >
                    {useAutoNumbering ? '✏️ Customize Tags' : '🔢 Auto-Number'}
                  </button>
                )}
              </div>

              {parseInt(form.quantity.toString()) === 1 || useAutoNumbering ? (
                <>
                  <input
                    type="text"
                    value={form.asset_tag_prefix}
                    onChange={(e) => setForm({ ...form, asset_tag_prefix: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder={parseInt(form.quantity.toString()) === 1 ? "LEAF-BLOWER-001" : "LEAF-BLOWER-"}
                    required
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {parseInt(form.quantity.toString()) === 1 
                      ? 'Full asset tag for single item'
                      : `Auto-numbering: ${form.asset_tag_prefix}001, ${form.asset_tag_prefix}002, etc.`}
                  </p>
                </>
              ) : (
                <>
                  <textarea
                    value={customTags}
                    onChange={(e) => setCustomTags(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
                    rows={Math.min(parseInt(form.quantity.toString()), 10)}
                    placeholder="LEAF-BLOWER-001&#10;LEAF-BLOWER-002&#10;LEAF-BLOWER-003"
                    required
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Enter {form.quantity} custom asset tags (one per line). Current: {customTags.split('\n').filter(t => t.trim()).length} tags
                  </p>
                </>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Location</label>
              <select
                value={form.location_id}
                onChange={(e) => setForm({ ...form, location_id: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">Select location...</option>
                {locations.map(loc => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name} ({loc.location_type?.name || 'Unknown'})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Serial/RFID Prefix</label>
              <input
                type="text"
                value={form.serial_number_prefix}
                onChange={(e) => setForm({ ...form, serial_number_prefix: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="RFID-"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Optional: Auto-numbered for bulk creation
              </p>
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
              <label className="block text-sm font-medium mb-1">Purchase Cost (each)</label>
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

          {parseInt(form.quantity.toString()) > 1 && useAutoNumbering && (
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="font-medium text-blue-900 mb-1">🔢 Auto-Numbering Preview</div>
              <div className="text-sm text-blue-700">
                Creating {form.quantity} assets: {form.asset_tag_prefix}001 through {form.asset_tag_prefix}{String(form.quantity).padStart(3, '0')}
              </div>
            </div>
          )}

          {parseInt(form.quantity.toString()) > 1 && !useAutoNumbering && customTags && (
            <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
              <div className="font-medium text-purple-900 mb-1">✏️ Custom Tags Preview</div>
              <div className="text-sm text-purple-700 max-h-32 overflow-y-auto">
                {customTags.split('\n').filter(t => t.trim()).slice(0, 5).map((tag, i) => (
                  <div key={i}>{i + 1}. {tag}</div>
                ))}
                {customTags.split('\n').filter(t => t.trim()).length > 5 && (
                  <div className="text-purple-600">... and {customTags.split('\n').filter(t => t.trim()).length - 5} more</div>
                )}
              </div>
            </div>
          )}

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
              {saving ? `Creating ${form.quantity} asset(s)...` : `Create ${form.quantity} Asset(s)`}
            </button>
          </div>
        </form>
      </div>
    </div>
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
  const [catalogItems, setCatalogItems] = useState<CatalogItemRow[]>([]);
  const [locations, setLocations] = useState<(LocationRow & { location_type?: Pick<LocationTypeRow, 'name'> | null })[]>([]);
  const [form, setForm] = useState({
    catalog_item_id: asset.catalog_item_id || '',
    asset_tag: asset.asset_tag,
    serial_number: asset.serial_number || '',
    location_id: asset.location_id || '',
    purchase_date: asset.purchase_date || '',
    purchase_cost: asset.purchase_cost?.toString() || '',
    warranty_expires: asset.warranty_expires || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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
        throw new Error('Missing last_event_id. Please refresh and try again.');
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
        },
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
function AssetAssignModal({ 
  asset, 
  assignmentTypes, 
  onClose, 
  onComplete 
}: { 
  asset: Asset; 
  assignmentTypes: AssignmentTypeRow[];
  onClose: () => void; 
  onComplete: () => void;
}) {
  const [form, setForm] = useState({
    assigned_to_type: assignmentTypes[0]?.type_key || 'employee',
    assigned_to_id: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const isReturn = (asset.asset_state?.current_status || asset.status) === 'assigned';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      if (isReturn) {
        await InventoryRPC.returnAsset({
          asset_id: asset.id,
          notes: form.notes,
          last_event_id: crypto.randomUUID(),
        });
      } else {
        await InventoryRPC.assignAsset({
          asset_id: asset.id,
          assigned_to_type: form.assigned_to_type,
          assigned_to_id: form.assigned_to_id,
          notes: form.notes,
          last_event_id: crypto.randomUUID(),
        });
      }

      onComplete();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            {isReturn ? 'Return Asset' : 'Assign Asset'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="p-3 bg-muted/50 rounded-lg">
            <div className="text-sm text-muted-foreground">Asset</div>
            <div className="font-medium">{asset.asset_tag}</div>
            <div className="text-sm">{asset.catalog_item?.name}</div>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">
              {error}
            </div>
          )}

          {!isReturn && (
            <>
              <div>
                <label className="block text-sm font-medium mb-1">Assign To *</label>
                <select
                  value={form.assigned_to_type}
                  onChange={(e) => setForm({ ...form, assigned_to_type: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="employee">Employee</option>
                  <option value="crew">Crew</option>
                  <option value="vehicle">Vehicle</option>
                  <option value="job">Job Site</option>
                  <option value="yard">Yard/Location</option>
                  <option value="department">Department</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  {form.assigned_to_type === 'employee' && 'Employee ID *'}
                  {form.assigned_to_type === 'crew' && 'Crew Name/ID *'}
                  {form.assigned_to_type === 'vehicle' && 'Vehicle ID *'}
                  {form.assigned_to_type === 'job' && 'Job Number/Site *'}
                  {form.assigned_to_type === 'yard' && 'Yard/Location *'}
                  {form.assigned_to_type === 'department' && 'Department *'}
                </label>
                <input
                  type="text"
                  value={form.assigned_to_id}
                  onChange={(e) => setForm({ ...form, assigned_to_id: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder={
                    form.assigned_to_type === 'employee' ? 'Employee ID or badge number' :
                    form.assigned_to_type === 'crew' ? 'Crew name' :
                    form.assigned_to_type === 'vehicle' ? 'Vehicle number' :
                    form.assigned_to_type === 'job' ? 'Job number or site name' :
                    form.assigned_to_type === 'yard' ? 'Yard name' :
                    'Department name'
                  }
                  required
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              rows={2}
              placeholder={isReturn ? 'Condition notes...' : 'Assignment notes...'}
            />
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
              {saving ? 'Processing...' : isReturn ? 'Return Asset' : 'Assign Asset'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
