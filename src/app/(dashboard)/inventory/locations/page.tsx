'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/FilterBar';
import { StatusChip } from '@/components/ui/StatusChip';
import { apiWrite } from '@/lib/api-client';

interface Location {
  id: string;
  name: string;
  location_type_id: string;
  location_type?: { name: string } | null;
  address?: string;
  parent_location_id?: string;
  active: boolean;
  created_at: string;
}

interface LocationType {
  value: string;
  label: string;
}

export default function LocationsPage() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [locationTypes, setLocationTypes] = useState<LocationType[]>([]);
  const [showAddTypeModal, setShowAddTypeModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);

  useEffect(() => {
    fetchLocationTypes();
    fetchLocations();
  }, [filters]);

  const fetchLocationTypes = async () => {
    try {
      const res = await fetch('/api/inventory/location-types');
      const { data } = await res.json();
      setLocationTypes(data || []);
    } catch (error) {
      console.error('Error fetching location types:', error);
    }
  };

  const fetchLocations = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.type) params.set('type', filters.type);

      const res = await fetch(`/api/inventory/locations?${params}`);
      const { data } = await res.json();
      setLocations(data || []);
    } catch (error) {
      console.error('Error fetching locations:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete location "${name}"?\n\nThis cannot be undone.`)) {
      return;
    }

    try {
      const res = await apiWrite(`/api/inventory/locations/${id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete location');
      }

      // Refresh the list
      fetchLocations();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const columns = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      render: (row: Location) => {
        // Find parent location to show hierarchy
        const parent = row.parent_location_id 
          ? locations.find(loc => loc.id === row.parent_location_id)
          : null;
        
        return (
          <div>
            <div className="font-medium">{row.name}</div>
            {parent && (
              <div className="text-xs text-gray-500 mt-0.5">
                ↳ Under: {parent.name}
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: 'location_type',
      header: 'Type',
      sortable: true,
      render: (row: Location) => (
        <StatusChip status={row.location_type?.name || 'Unknown'} />
      ),
    },
    {
      key: 'address',
      header: 'Address',
      render: (row: Location) => (
        <span className="text-muted-foreground">{row.address || '-'}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: Location) => (
        <StatusChip status={row.active ? 'active' : 'inactive'} />
      ),
    },
    {
      key: 'created_at',
      header: 'Created',
      sortable: true,
      render: (row: Location) => new Date(row.created_at).toLocaleDateString(),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (row: Location) => (
        <div className="flex gap-3">
          <button
            onClick={() => setEditingLocation(row)}
            className="text-primary hover:text-primary/80 text-sm font-medium"
          >
            Edit
          </button>
          <button
            onClick={() => handleDelete(row.id, row.name)}
            className="text-red-600 hover:text-red-800 text-sm font-medium"
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  const filterConfig = [
    {
      key: 'type',
      label: 'Type',
      type: 'select' as const,
      options: locationTypes,
    },
    {
      key: 'search',
      label: 'Search',
      type: 'search' as const,
      placeholder: 'Location name...',
    },
  ];

  const filteredLocations = locations.filter((loc) => {
    if (filters.search && !loc.name.toLowerCase().includes(filters.search.toLowerCase())) {
      return false;
    }
    return true;
  });

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Locations"
          description="Manage warehouses, yards, trucks, and other inventory locations. Example: Set up locations like 'Main Plant Yard', 'Truck #12', 'Highway 50 Job Site', or 'Vendor: ABC Concrete Supply' to track where materials are stored or in transit."
          actions={
            <div className="flex gap-2">
              <button
                onClick={() => setShowAddTypeModal(true)}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors"
              >
                Manage Types
              </button>
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
              >
                + Add Location
              </button>
            </div>
          }
        />

        <FilterBar
          filters={filterConfig}
          values={filters}
          onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
          onClear={() => setFilters({})}
        />

        <DataTable
          data={filteredLocations}
          columns={columns}
          loading={loading}
          emptyMessage="No locations found"
          rowKey={(row) => row.id}
        />

        {(showCreateModal || editingLocation) && (
          <CreateLocationModal
            location={editingLocation}
            onClose={() => {
              setShowCreateModal(false);
              setEditingLocation(null);
            }}
            onCreated={() => {
              setShowCreateModal(false);
              setEditingLocation(null);
              fetchLocations();
            }}
            onAddNewType={() => setShowAddTypeModal(true)}
          />
        )}

        {showAddTypeModal && (
          <AddLocationTypeModal
            onClose={() => setShowAddTypeModal(false)}
            onCreated={() => {
              setShowAddTypeModal(false);
              fetchLocationTypes();
            }}
          />
        )}
      </div>
    </AppShell>
  );
}

function CreateLocationModal({ location, onClose, onCreated, onAddNewType }: { location?: Location | null; onClose: () => void; onCreated: () => void; onAddNewType: () => void }) {
  const isEditing = !!location;
  const [form, setForm] = useState({
    name: location?.name || '',
    location_type_id: location?.location_type_id || '',
    address: location?.address || '',
    parent_location_id: location?.parent_location_id || '',
    active: location?.active !== undefined ? location.active : true,
  });
  const [locationTypes, setLocationTypes] = useState<LocationType[]>([]);
  const [availableParents, setAvailableParents] = useState<Location[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchLocationTypes();
    fetchAvailableParents();
  }, []);

  const fetchLocationTypes = async () => {
    try {
      const res = await fetch('/api/inventory/location-types');
      const { data} = await res.json();
      setLocationTypes(data || []);
      // Set first type as default only when creating a new location (not editing)
      if (data && data.length > 0 && !isEditing && !form.location_type_id) {
        setForm(prev => ({ ...prev, location_type_id: data[0].value }));
      }
    } catch (error) {
      console.error('Error fetching location types:', error);
    }
  };

  const fetchAvailableParents = async () => {
    try {
      const res = await fetch('/api/inventory/locations');
      const { data } = await res.json();
      // Filter out the current location when editing to prevent circular references
      const filtered = isEditing 
        ? (data || []).filter((loc: Location) => loc.id !== location.id)
        : (data || []);
      setAvailableParents(filtered);
    } catch (error) {
      console.error('Error fetching locations:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      const url = isEditing ? `/api/inventory/locations/${location.id}` : '/api/inventory/locations';
      const method = isEditing ? 'PUT' : 'POST';
      
      // Convert empty string to null for parent_location_id
      const payload = {
        ...form,
        parent_location_id: form.parent_location_id || null,
      };
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Failed to ${isEditing ? 'update' : 'create'} location`);
      }

      onCreated();
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
          <h3 className="text-lg font-semibold">{isEditing ? 'Edit Location' : 'Create Location'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">Name *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              required
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium">Type *</label>
              <button
                type="button"
                onClick={onAddNewType}
                className="text-xs text-primary hover:underline"
              >
                + Add New Type
              </button>
            </div>
            <select
              value={form.location_type_id}
              onChange={(e) => setForm({ ...form, location_type_id: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              required
            >
              {locationTypes.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Parent Location</label>
            <select
              value={form.parent_location_id}
              onChange={(e) => setForm({ ...form, parent_location_id: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">None (Top Level)</option>
              {availableParents.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name} ({loc.location_type?.name || 'Unknown'})
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">Optional: Organize locations hierarchically (e.g., Warehouse → Zone → Aisle)</p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Address</label>
            <textarea
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              rows={2}
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
              {saving ? (isEditing ? 'Saving...' : 'Creating...') : (isEditing ? 'Save Changes' : 'Create Location')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddLocationTypeModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    name: '',
    description: '',
  });
  const [existingTypes, setExistingTypes] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    fetchTypes();
  }, []);

  const fetchTypes = async () => {
    try {
      const res = await fetch('/api/inventory/location-types');
      const { data } = await res.json();
      setExistingTypes(data || []);
    } catch (error) {
      console.error('Error fetching types:', error);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete location type "${name}"?\n\nYou can only delete types that are not in use.`)) {
      return;
    }

    try {
      const res = await apiWrite(`/api/inventory/location-types/${id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete location type');
      }

      fetchTypes();
      onCreated(); // Refresh parent list
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      const res = await apiWrite('/api/inventory/location-types', {
        method: 'POST',
        body: form,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create location type');
      }

      // Reset form and refresh list
      setForm({ name: '', description: '' });
      setShowAddForm(false);
      fetchTypes();
      onCreated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold">Manage Location Types</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {/* Existing Types List */}
          <div className="mb-6">
            <h4 className="text-sm font-medium mb-3">Existing Types ({existingTypes.length})</h4>
            {existingTypes.length === 0 ? (
              <p className="text-sm text-gray-500">No location types yet.</p>
            ) : (
              <div className="space-y-2">
                {existingTypes.map((type) => (
                  <div key={type.value} className="flex items-center justify-between p-3 border rounded-md">
                    <div>
                      <div className="font-medium">{type.label}</div>
                      {type.description && (
                        <div className="text-sm text-gray-500">{type.description}</div>
                      )}
                    </div>
                    <button
                      onClick={() => handleDelete(type.value, type.label)}
                      className="text-red-600 hover:text-red-800 text-sm font-medium"
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add New Type Form */}
          {!showAddForm ? (
            <button
              onClick={() => setShowAddForm(true)}
              className="w-full px-4 py-2 border-2 border-dashed border-gray-300 text-gray-600 rounded-md hover:border-gray-400 hover:text-gray-700"
            >
              + Add New Type
            </button>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 p-4 border rounded-md bg-gray-50">
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium mb-1">Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g., Storage Facility"
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">A unique code will be generated automatically</p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Optional description"
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  rows={2}
                />
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddForm(false);
                    setError('');
                    setForm({ name: '', description: '' });
                  }}
                  className="flex-1 px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
                >
                  {saving ? 'Adding...' : 'Add Type'}
                </button>
              </div>
            </form>
          )}
        </div>

        <div className="px-6 py-4 border-t">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
