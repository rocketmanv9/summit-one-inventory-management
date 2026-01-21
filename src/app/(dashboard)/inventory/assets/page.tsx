'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/FilterBar';
import { StatusChip } from '@/components/ui/StatusChip';

interface Asset {
  id: string;
  asset_tag: string;
  serial_number?: string;
  catalog_item_id?: string;
  location_id?: string;
  status: string;
  purchase_date?: string;
  purchase_cost?: number;
  warranty_expires?: string;
  catalog_items?: { id: string; name: string; sku: string };
  locations?: { id: string; name: string; location_type: string };
  asset_state?: { status: string; current_location_id: string };
}

export default function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [showAssignModal, setShowAssignModal] = useState(false);

  useEffect(() => {
    fetchAssets();
  }, [filters]);

  const fetchAssets = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.status) params.set('status', filters.status);
      if (filters.assigned === 'true') params.set('assigned', 'true');

      const res = await fetch(`/api/inventory/assets?${params}`);
      const { data } = await res.json();
      setAssets(data || []);
    } catch (error) {
      console.error('Error fetching assets:', error);
    } finally {
      setLoading(false);
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
          <div className="font-medium">{row.catalog_items?.name || '-'}</div>
          <div className="text-xs text-muted-foreground">{row.catalog_items?.sku || ''}</div>
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
      render: (row: Asset) => row.locations?.name || '-',
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: Asset) => (
        <StatusChip status={row.asset_state?.status || row.status || 'available'} />
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
              setShowAssignModal(true);
            }}
            className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded hover:bg-blue-200"
          >
            {row.status === 'assigned' ? 'Return' : 'Assign'}
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
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              + Add Asset
            </button>
          }
        />

        <div className="grid grid-cols-4 gap-4">
          <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="text-2xl font-bold text-green-700">
              {assets.filter(a => a.status === 'available').length}
            </div>
            <div className="text-sm text-green-600">Available</div>
          </div>
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="text-2xl font-bold text-blue-700">
              {assets.filter(a => a.status === 'assigned').length}
            </div>
            <div className="text-sm text-blue-600">Assigned</div>
          </div>
          <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg">
            <div className="text-2xl font-bold text-orange-700">
              {assets.filter(a => a.status === 'maintenance').length}
            </div>
            <div className="text-sm text-orange-600">In Maintenance</div>
          </div>
          <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
            <div className="text-2xl font-bold text-gray-700">
              {assets.filter(a => a.status === 'retired').length}
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

        {showAssignModal && selectedAsset && (
          <AssetAssignModal
            asset={selectedAsset}
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
      </div>
    </AppShell>
  );
}

function AssetAssignModal({ asset, onClose, onComplete }: { asset: Asset; onClose: () => void; onComplete: () => void }) {
  const [form, setForm] = useState({
    assigned_to_type: 'employee',
    assigned_to_id: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const isReturn = asset.status === 'assigned';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      const endpoint = isReturn
        ? `/api/inventory/assets/${asset.id}/return`
        : `/api/inventory/assets/${asset.id}/assign`;

      const body = isReturn
        ? { notes: form.notes }
        : form;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Operation failed');
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
            <div className="text-sm">{asset.catalog_items?.name}</div>
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
                  <option value="vehicle">Vehicle</option>
                  <option value="job">Job Site</option>
                  <option value="department">Department</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">ID/Reference *</label>
                <input
                  type="text"
                  value={form.assigned_to_id}
                  onChange={(e) => setForm({ ...form, assigned_to_id: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="Employee ID, Vehicle ID, or Job Number"
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
