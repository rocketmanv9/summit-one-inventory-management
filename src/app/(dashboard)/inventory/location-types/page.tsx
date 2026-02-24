'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/FilterBar';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { LocationTypeModal } from '@/components/modals/LocationTypeModal';
import type { Database } from 'types/supabase';

type LocationTypeRow = Database['inventory']['Tables']['location_types']['Row'];

export default function LocationTypesPage() {
  const [types, setTypes] = useState<LocationTypeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingType, setEditingType] = useState<LocationTypeRow | null>(null);

  useEffect(() => {
    fetchTypes();
  }, []);

  const fetchTypes = async () => {
    setLoading(true);
    try {
      const data = await InventoryRPC.getLocationTypes();
      setTypes(data || []);
    } catch (error) {
      console.error('Error fetching location types:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (type: LocationTypeRow) => {
    if (!confirm(`Delete location type "${type.name}"?\n\nYou can only delete types that are not in use.`)) {
      return;
    }

    try {
      if (!type.last_event_id) {
        throw new Error('Missing last_event_id for this location type. Please refresh and try again.');
      }

      await InventoryRPC.deleteLocationType(type.id, type.last_event_id);
      fetchTypes();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const columns = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      render: (row: LocationTypeRow) => (
        <span className="font-medium">{row.name}</span>
      ),
    },
    {
      key: 'code',
      header: 'Code',
      render: (row: LocationTypeRow) => (
        <code className="bg-gray-100 px-2 py-1 rounded text-xs">{row.code}</code>
      ),
    },
    {
      key: 'description',
      header: 'Description',
      render: (row: LocationTypeRow) => (
        <span className="text-muted-foreground">{row.description || '-'}</span>
      ),
    },
    {
      key: 'created_at',
      header: 'Created',
      sortable: true,
      render: (row: LocationTypeRow) => new Date(row.created_at).toLocaleDateString(),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (row: LocationTypeRow) => (
        <div className="flex gap-3">
          <button
            onClick={() => setEditingType(row)}
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
      key: 'search',
      label: 'Search',
      type: 'search' as const,
      placeholder: 'Type name...',
    },
  ];

  const filteredTypes = types.filter((type) => {
    if (filters.search) {
      const term = filters.search.toLowerCase();
      return (
        type.name.toLowerCase().includes(term) ||
        type.code.toLowerCase().includes(term) ||
        (type.description || '').toLowerCase().includes(term)
      );
    }
    return true;
  });

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Location Types"
          description="Manage location types used to classify your inventory locations (e.g., Warehouse, Yard, Truck, Job Site)."
          actions={
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              + Add Location Type
            </button>
          }
        />

        <FilterBar
          filters={filterConfig}
          values={filters}
          onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
          onClear={() => setFilters({})}
        />

        <DataTable
          data={filteredTypes}
          columns={columns}
          loading={loading}
          emptyMessage="No location types found"
          rowKey={(row) => row.id}
        />

        <LocationTypeModal
          open={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            fetchTypes();
          }}
        />

        <LocationTypeModal
          open={!!editingType}
          onClose={() => setEditingType(null)}
          onSuccess={() => {
            setEditingType(null);
            fetchTypes();
          }}
          item={editingType ?? undefined}
        />
      </div>
    </AppShell>
  );
}
