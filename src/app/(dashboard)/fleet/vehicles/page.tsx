'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/FilterBar';
import { StatusChip } from '@/components/ui/StatusChip';

/* ---------- Types ---------- */

type Vehicle = {
  id: string;
  name: string;
  vehicle_type_id: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  description: string | null;
  notes: string | null;
  tags: string[] | null;
  is_active: boolean;
  is_custom: boolean;
  created_at: string;
};

type CatalogVehicle = {
  id: string;
  name: string;
  make: string | null;
  model: string | null;
  year: number | null;
  description: string | null;
};

/* ---------- Main Page ---------- */

export default function VehiclesPage() {
  const [activeTab, setActiveTab] = useState<'my' | 'catalog'>('my');
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [catalogVehicles, setCatalogVehicles] = useState<CatalogVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedCatalogIds, setSelectedCatalogIds] = useState<Set<string>>(new Set());
  const [adopting, setAdopting] = useState(false);

  useEffect(() => {
    if (activeTab === 'my') {
      fetchVehicles();
    } else {
      fetchCatalogVehicles();
    }
  }, [activeTab]);

  /* ---------- Fetchers ---------- */

  const fetchVehicles = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/gv/vehicles');
      if (!res.ok) throw new Error('Failed to fetch vehicles');
      const json = await res.json();
      setVehicles(json.data || []);
    } catch (err) {
      console.error('Error fetching vehicles:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchCatalogVehicles = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/gv/vehicles/catalog');
      if (!res.ok) throw new Error('Failed to fetch catalog vehicles');
      const json = await res.json();
      setCatalogVehicles(json.data || []);
    } catch (err) {
      console.error('Error fetching catalog vehicles:', err);
    } finally {
      setLoading(false);
    }
  };

  /* ---------- Handlers ---------- */

  const handleDeleteVehicle = async (vehicle: Vehicle) => {
    if (!confirm(`Delete vehicle "${vehicle.name}"? This cannot be undone.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/gv/vehicles/${vehicle.id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': crypto.randomUUID(),
        },
      });
      if (!res.ok) throw new Error('Failed to delete vehicle');
      await fetchVehicles();
    } catch (err) {
      console.error('Error deleting vehicle:', err);
      alert('Failed to delete vehicle');
    }
  };

  const handleAdoptSelected = async () => {
    if (selectedCatalogIds.size === 0) return;
    setAdopting(true);

    try {
      const res = await fetch('/api/gv/vehicles/adopt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ catalogVehicleIds: Array.from(selectedCatalogIds) }),
      });
      if (!res.ok) throw new Error('Failed to adopt vehicles');

      setSelectedCatalogIds(new Set());
      setActiveTab('my');
      await fetchVehicles();
    } catch (err) {
      console.error('Error adopting vehicles:', err);
      alert('Failed to adopt selected vehicles');
    } finally {
      setAdopting(false);
    }
  };

  const toggleCatalogSelection = (id: string) => {
    setSelectedCatalogIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  /* ---------- Stats ---------- */

  const totalCount = vehicles.length;
  const catalogCount = vehicles.filter((v) => !v.is_custom).length;
  const customCount = vehicles.filter((v) => v.is_custom).length;

  /* ---------- My Vehicles table config ---------- */

  const columns = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      render: (row: Vehicle) => (
        <span className="font-medium">{row.name}</span>
      ),
    },
    {
      key: 'vehicle_type_id',
      header: 'Type',
      render: (row: Vehicle) => row.vehicle_type_id || '-',
    },
    {
      key: 'make',
      header: 'Make',
      render: (row: Vehicle) => row.make || '-',
    },
    {
      key: 'model',
      header: 'Model',
      render: (row: Vehicle) => row.model || '-',
    },
    {
      key: 'year',
      header: 'Year',
      render: (row: Vehicle) => row.year ?? '-',
    },
    {
      key: 'source',
      header: 'Source',
      render: (row: Vehicle) => (row.is_custom ? 'Custom' : 'Catalog'),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: Vehicle) => (
        <StatusChip status={row.is_active ? 'active' : 'inactive'} />
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row: Vehicle) => (
        <div className="flex gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              // Edit not wired yet — placeholder
            }}
            className="px-2 py-1 text-xs bg-gray-100 text-gray-800 rounded hover:bg-gray-200"
          >
            Edit
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDeleteVehicle(row);
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
      key: 'search',
      label: 'Search',
      type: 'search' as const,
      placeholder: 'Vehicle name...',
    },
  ];

  const filteredVehicles = vehicles.filter((v) => {
    if (filters.search) {
      const term = filters.search.toLowerCase();
      return v.name.toLowerCase().includes(term);
    }
    return true;
  });

  const filteredCatalog = catalogVehicles.filter((v) => {
    if (filters.search) {
      const term = filters.search.toLowerCase();
      return v.name.toLowerCase().includes(term);
    }
    return true;
  });

  /* ---------- Render ---------- */

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Vehicles"
          description="Manage your organization's vehicle fleet references. Browse the shared catalog to adopt standard vehicle types, or add custom vehicles specific to your fleet."
          actions={
            activeTab === 'my' ? (
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
              >
                + Add Vehicle
              </button>
            ) : (
              <button
                onClick={handleAdoptSelected}
                disabled={selectedCatalogIds.size === 0 || adopting}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {adopting
                  ? 'Adopting...'
                  : `Adopt Selected (${selectedCatalogIds.size})`}
              </button>
            )
          }
        />

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4">
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="text-2xl font-bold text-blue-700">{totalCount}</div>
            <div className="text-sm text-blue-600">Total Vehicles</div>
          </div>
          <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="text-2xl font-bold text-green-700">{catalogCount}</div>
            <div className="text-sm text-green-600">Catalog</div>
          </div>
          <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
            <div className="text-2xl font-bold text-purple-700">{customCount}</div>
            <div className="text-sm text-purple-600">Custom</div>
          </div>
        </div>

        {/* Tab buttons */}
        <div className="flex gap-2 border-b pb-0">
          <button
            onClick={() => setActiveTab('my')}
            className={`px-4 py-2 text-sm font-medium rounded-t-md border border-b-0 transition-colors ${
              activeTab === 'my'
                ? 'bg-white text-primary border-gray-300'
                : 'bg-gray-50 text-gray-500 border-transparent hover:text-gray-700'
            }`}
          >
            My Vehicles
          </button>
          <button
            onClick={() => setActiveTab('catalog')}
            className={`px-4 py-2 text-sm font-medium rounded-t-md border border-b-0 transition-colors ${
              activeTab === 'catalog'
                ? 'bg-white text-primary border-gray-300'
                : 'bg-gray-50 text-gray-500 border-transparent hover:text-gray-700'
            }`}
          >
            Catalog
          </button>
        </div>

        {/* Search filter */}
        <FilterBar
          filters={filterConfig}
          values={filters}
          onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
          onClear={() => setFilters({})}
        />

        {/* Tab content */}
        {activeTab === 'my' ? (
          <DataTable
            data={filteredVehicles}
            columns={columns}
            loading={loading}
            emptyMessage="No vehicles found. Add a custom vehicle or adopt from the catalog."
            rowKey={(row) => row.id}
          />
        ) : (
          <CatalogGrid
            vehicles={filteredCatalog}
            loading={loading}
            selectedIds={selectedCatalogIds}
            onToggle={toggleCatalogSelection}
          />
        )}

        {/* Create modal */}
        {showCreateModal && (
          <CreateVehicleModal
            onClose={() => setShowCreateModal(false)}
            onComplete={() => {
              setShowCreateModal(false);
              fetchVehicles();
            }}
          />
        )}
      </div>
    </AppShell>
  );
}

/* ---------- Catalog Grid ---------- */

function CatalogGrid({
  vehicles,
  loading,
  selectedIds,
  onToggle,
}: {
  vehicles: CatalogVehicle[];
  loading: boolean;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        Loading catalog...
      </div>
    );
  }

  if (vehicles.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        No catalog vehicles found.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {vehicles.map((vehicle) => {
        const isSelected = selectedIds.has(vehicle.id);
        return (
          <div
            key={vehicle.id}
            onClick={() => onToggle(vehicle.id)}
            className={`p-4 border rounded-lg cursor-pointer transition-colors ${
              isSelected
                ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                : 'border-gray-200 hover:border-gray-300 bg-white'
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="font-medium">{vehicle.name}</div>
                <div className="text-sm text-muted-foreground mt-1">
                  {[vehicle.make, vehicle.model, vehicle.year]
                    .filter(Boolean)
                    .join(' / ') || 'No details'}
                </div>
                {vehicle.description && (
                  <div className="text-xs text-muted-foreground mt-2 line-clamp-2">
                    {vehicle.description}
                  </div>
                )}
              </div>
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => onToggle(vehicle.id)}
                onClick={(e) => e.stopPropagation()}
                className="ml-3 mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Create Vehicle Modal ---------- */

function CreateVehicleModal({
  onClose,
  onComplete,
}: {
  onClose: () => void;
  onComplete: () => void;
}) {
  const [form, setForm] = useState({
    name: '',
    make: '',
    model: '',
    year: '',
    description: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      const payload: Record<string, unknown> = {
        name: form.name,
      };
      if (form.make) payload.make = form.make;
      if (form.model) payload.model = form.model;
      if (form.year) payload.year = parseInt(form.year, 10);
      if (form.description) payload.description = form.description;
      if (form.notes) payload.notes = form.notes;

      const res = await fetch('/api/gv/vehicles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error?.message || 'Failed to create vehicle');
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
          <h3 className="text-lg font-semibold">Add Vehicle</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            X
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="Ford F-350 Super Duty"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Make</label>
              <input
                type="text"
                value={form.make}
                onChange={(e) => setForm({ ...form, make: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="Ford"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Model</label>
              <input
                type="text"
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="F-350"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Year</label>
              <input
                type="number"
                value={form.year}
                onChange={(e) => setForm({ ...form, year: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="2024"
                min="1900"
                max="2100"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                rows={2}
                placeholder="Optional description of the vehicle..."
              />
            </div>

            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                rows={2}
                placeholder="Internal notes..."
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
              {saving ? 'Creating...' : 'Create Vehicle'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
