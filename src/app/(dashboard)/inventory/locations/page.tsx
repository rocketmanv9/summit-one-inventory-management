'use client';

import { AppError } from '@rocketmanv9/chassis/errors';

import { useState, useEffect, useCallback, useRef } from 'react';

import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/FilterBar';
import { StatusChip } from '@/components/ui/StatusChip';
import { LocationTypeModal } from '@/components/modals/LocationTypeModal';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { useUOMLabelMap, useUOMTerms } from '@/hooks/useGVTerms';
import { geocodeAddress } from '@/lib/geocode';
import type { Database } from 'types/supabase';

type LocationRow = Database['inventory']['Tables']['locations']['Row'];
type LocationTypeRow = Database['inventory']['Tables']['location_types']['Row'];

type Location = LocationRow & { location_type?: { name: string } | null };

interface LocationType {
  value: string;
  label: string;
  description?: string;
  last_event_id?: string | null;
}

function normalizeLocationTypes(data: LocationTypeRow[] | null | undefined): LocationType[] {
  return (data || [])
    .map((type) => ({
      value: type.id,
      label: type.name,
      description: type.description || undefined,
      last_event_id: type.last_event_id ?? null,
    }))
    .filter((type) => type.value && type.label);
}

export default function LocationsPage() {
  const router = useRouter();
  const uomLabels = useUOMLabelMap();
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [locationTypes, setLocationTypes] = useState<LocationType[]>([]);
  const [showQuickAddType, setShowQuickAddType] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);

  useEffect(() => {
    fetchLocationTypes();
    fetchLocations();
  }, [filters]);

  const fetchLocationTypes = async () => {
    try {
      const data = await InventoryRPC.getLocationTypes();
      setLocationTypes(normalizeLocationTypes(data));
    } catch (error) {
      console.error('Error fetching location types:', error);
    }
  };

  const fetchLocations = async () => {
    setLoading(true);
    try {
      const data = await InventoryRPC.getLocations({
        type: filters.type || undefined,
      });
      setLocations(data || []);
    } catch (error) {
      console.error('Error fetching locations:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (location: Location) => {
    if (!confirm(`Are you sure you want to delete location "${location.name}"?\n\nThis cannot be undone.`)) {
      return;
    }

    try {
      if (!location.last_event_id) {
        throw AppError.badRequest('Missing last_event_id for this location. Please refresh and try again.');
      }

      await InventoryRPC.deleteLocation(location.id, location.last_event_id);
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
        const parent = row.parent_location_id
          ? locations.find(loc => loc.id === row.parent_location_id)
          : null;

        return (
          <div>
            <button
              onClick={() => router.push(`/inventory/locations/${row.id}`)}
              className="font-medium text-primary hover:underline text-left"
            >
              {row.name}
            </button>
            {parent && (
              <div className="text-xs text-gray-500 mt-0.5">
                Under: {parent.name}
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
      key: 'capacity',
      header: 'Capacity',
      render: (row: Location) => {
        if (!(row as any).max_capacity) return <span className="text-muted-foreground">-</span>;
        return (
          <span className="text-sm font-mono">
            {(row as any).max_capacity} {uomLabels[(row as any).capacity_uom_term_id] || (row as any).capacity_uom_term_id || ''}
          </span>
        );
      },
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
            onClick={() => handleDelete(row)}
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
            onAddNewType={() => setShowQuickAddType(true)}
          />
        )}

        <LocationTypeModal
          open={showQuickAddType}
          onClose={() => setShowQuickAddType(false)}
          onSuccess={() => {
            setShowQuickAddType(false);
            fetchLocationTypes();
          }}
        />
      </div>
    </AppShell>
  );
}

function CreateLocationModal({ location, onClose, onCreated, onAddNewType }: { location?: Location | null; onClose: () => void; onCreated: () => void; onAddNewType: () => void }) {
  const isEditing = !!location;
  const { terms: uomTerms, loading: uomLoading } = useUOMTerms();
  const [form, setForm] = useState({
    name: location?.name || '',
    location_type_id: location?.location_type_id || '',
    address: location?.address || '',
    address_line_1: (location as any)?.address_line_1 || '',
    address_line_2: (location as any)?.address_line_2 || '',
    city: (location as any)?.city || '',
    state: (location as any)?.state || '',
    postal_code: (location as any)?.postal_code || '',
    country: (location as any)?.country || 'US',
    parent_location_id: location?.parent_location_id || '',
    active: location?.active !== undefined ? location.active : true,
    max_capacity: (location as any)?.max_capacity?.toString() || '',
    capacity_uom_term_id: (location as any)?.capacity_uom_term_id || '',
    latitude: (location as any)?.latitude?.toString() || '',
    longitude: (location as any)?.longitude?.toString() || '',
  });
  const [locationTypes, setLocationTypes] = useState<LocationType[]>([]);
  const [availableParents, setAvailableParents] = useState<Location[]>([]);
  const [saving, setSaving] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [error, setError] = useState('');
  const lastGeocodedAddress = useRef('');

  const autoGeocode = useCallback(async (address: string) => {
    const trimmed = address.trim();
    if (!trimmed || trimmed === lastGeocodedAddress.current) return;
    // Skip if coordinates are already manually entered
    if (form.latitude && form.longitude) return;

    lastGeocodedAddress.current = trimmed;
    setGeocoding(true);
    try {
      const result = await geocodeAddress(trimmed);
      if (result) {
        setForm((prev) => ({
          ...prev,
          latitude: result.latitude.toString(),
          longitude: result.longitude.toString(),
        }));
      }
    } catch {
      // Silent fail on auto-geocode — user can manually geocode or enter coords
    } finally {
      setGeocoding(false);
    }
  }, [form.latitude, form.longitude]);

  useEffect(() => {
    fetchLocationTypes();
    fetchAvailableParents();
  }, []);

  const fetchLocationTypes = async () => {
    try {
      const data = await InventoryRPC.getLocationTypes();
      const normalized = normalizeLocationTypes(data);
      setLocationTypes(normalized);
      if (normalized.length > 0 && !isEditing && !form.location_type_id) {
        setForm(prev => ({ ...prev, location_type_id: normalized[0].value }));
      }
    } catch (error) {
      console.error('Error fetching location types:', error);
    }
  };

  const fetchAvailableParents = async () => {
    try {
      const data = await InventoryRPC.getLocations();
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
      const selectedType = locationTypes.find((type) => type.value === form.location_type_id);
      const locationTypeName = selectedType?.label || location?.location_type?.name || '';

      if (!locationTypeName) {
        throw AppError.badRequest('Please select a location type.');
      }

      const base = {
        ...form,
        parent_location_id: form.parent_location_id || null,
        address_line_1: form.address_line_1 || null,
        address_line_2: form.address_line_2 || null,
        city: form.city || null,
        state: form.state || null,
        postal_code: form.postal_code || null,
        country: form.country || 'US',
        max_capacity: form.max_capacity ? parseFloat(form.max_capacity) : null,
        capacity_uom_term_id: form.capacity_uom_term_id || null,
        latitude: form.latitude ? parseFloat(form.latitude) : null,
        longitude: form.longitude ? parseFloat(form.longitude) : null,
      };

      if (isEditing && location) {
        if (!location.last_event_id) {
          throw AppError.badRequest('Missing last_event_id for this location. Please refresh and try again.');
        }
        await InventoryRPC.updateLocation(location.id, base, location.last_event_id);
      } else {
        await InventoryRPC.createLocation(base);
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
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">x</button>
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
              {locationTypes.map((type, index) => (
                <option key={type.value || type.label || index} value={type.value}>
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
            <p className="text-xs text-gray-500 mt-1">Optional: Organize locations hierarchically (e.g., Warehouse &rarr; Zone &rarr; Aisle)</p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Address</label>
            <textarea
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              onBlur={(e) => autoGeocode(e.target.value)}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              rows={2}
            />
            {geocoding && (
              <p className="mt-1 text-xs text-muted-foreground animate-pulse">Geocoding address...</p>
            )}
          </div>

          {/* Structured address fields for Amazon Business shipping */}
          <details className="group">
            <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
              Structured address fields (for Amazon Business shipping)
            </summary>
            <div className="mt-3 space-y-3 p-3 bg-gray-50 border rounded-lg">
              <p className="text-xs text-muted-foreground">
                These fields are required for placing Amazon Business orders to this location.
              </p>
              <div>
                <label className="block text-sm font-medium mb-1">Address Line 1</label>
                <input type="text" value={form.address_line_1}
                  onChange={(e) => setForm({ ...form, address_line_1: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                  placeholder="123 Main St" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Address Line 2</label>
                <input type="text" value={form.address_line_2}
                  onChange={(e) => setForm({ ...form, address_line_2: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                  placeholder="Suite 100, Building A, etc." />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">City</label>
                  <input type="text" value={form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                    placeholder="Seattle" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">State</label>
                  <input type="text" value={form.state}
                    onChange={(e) => setForm({ ...form, state: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                    placeholder="WA" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Postal Code</label>
                  <input type="text" value={form.postal_code}
                    onChange={(e) => setForm({ ...form, postal_code: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                    placeholder="98101" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Country</label>
                  <input type="text" value={form.country}
                    onChange={(e) => setForm({ ...form, country: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                    placeholder="US" />
                </div>
              </div>
            </div>
          </details>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Latitude</label>
              <input
                type="number"
                step="any"
                value={form.latitude}
                onChange={(e) => setForm({ ...form, latitude: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="e.g. 47.3073"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Longitude</label>
              <input
                type="number"
                step="any"
                value={form.longitude}
                onChange={(e) => setForm({ ...form, longitude: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="e.g. -122.2285"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Max Capacity</label>
              <input
                type="number"
                step="any"
                value={form.max_capacity}
                onChange={(e) => setForm({ ...form, max_capacity: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="Leave empty for unlimited"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Capacity Unit</label>
              <select
                value={form.capacity_uom_term_id}
                onChange={(e) => setForm({ ...form, capacity_uom_term_id: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">None</option>
                {uomLoading ? (
                  <option disabled>Loading...</option>
                ) : (
                  uomTerms.map((t) => (
                    <option key={t.term_id} value={t.term_id}>{t.label}</option>
                  ))
                )}
              </select>
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
              {saving ? (isEditing ? 'Saving...' : 'Creating...') : (isEditing ? 'Save Changes' : 'Create Location')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
