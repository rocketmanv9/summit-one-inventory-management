'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/FilterBar';
import { ReservationTypeModal } from '@/components/modals/ReservationTypeModal';
import { InventoryRPC } from '@/lib/rpc/inventory';

interface ReservationType {
  id: string;
  tenant_id: string | null;
  type_key: string;
  display_name: string;
  is_system: boolean;
  is_active: boolean;
  sort_order: number;
  description?: string | null;
  last_event_id: string;
}

export default function ReservationTypesSettingsPage() {
  const [types, setTypes] = useState<ReservationType[]>([]);
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingType, setEditingType] = useState<ReservationType | null>(null);

  useEffect(() => {
    fetchTypes();
  }, []);

  const fetchTypes = async () => {
    setLoading(true);
    try {
      const data = await InventoryRPC.getReservationTypes({ includeInactive: true });
      setTypes((data || []) as ReservationType[]);
      const counts = await InventoryRPC.getReservationTypeUsage((data || []).map((t) => t.type_key));
      setUsage(counts);
    } catch (error) {
      console.error('Error fetching reservation types:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (type: ReservationType) => {
    if (type.is_system || !type.tenant_id) {
      alert('Cannot delete global reservation types. You can add your own custom types instead.');
      return;
    }

    const inUse = usage[type.type_key] ?? 0;
    if (inUse > 0) {
      alert(`"${type.display_name}" is used by ${inUse} reservation(s) and can't be deleted. Deactivate it instead to hide it from new reservations.`);
      return;
    }

    if (!confirm(`Delete reservation type "${type.display_name}"? This cannot be undone.`)) {
      return;
    }

    try {
      await InventoryRPC.deleteReservationType(type.id);
      await fetchTypes();
    } catch (error: any) {
      console.error('Error deleting reservation type:', error);
      alert(error?.message || 'Failed to delete reservation type');
    }
  };

  const handleToggleActive = async (type: ReservationType) => {
    if (type.is_system || !type.tenant_id) {
      alert('Global reservation types cannot be modified. Add a custom type if you need different options.');
      return;
    }

    try {
      await InventoryRPC.updateReservationType(type.id, { is_active: !type.is_active });
      await fetchTypes();
    } catch (error: any) {
      console.error('Error updating reservation type:', error);
      alert(error?.message || 'Failed to update reservation type');
    }
  };

  const columns = [
    {
      key: 'display_name',
      header: 'Type',
      sortable: true,
      render: (row: ReservationType) => (
        <span className={`font-medium ${!row.is_active ? 'opacity-50' : ''}`}>{row.display_name}</span>
      ),
    },
    {
      key: 'type_key',
      header: 'Key',
      render: (row: ReservationType) => (
        <code className="bg-gray-100 px-2 py-1 rounded text-xs">{row.type_key}</code>
      ),
    },
    {
      key: 'description',
      header: 'Description',
      render: (row: ReservationType) => (
        <span className="text-muted-foreground">{row.description || '-'}</span>
      ),
    },
    {
      key: 'is_active',
      header: 'Status',
      render: (row: ReservationType) => (
        <span className={`inline-flex px-2 py-1 text-xs font-medium rounded ${
          row.is_active
            ? 'bg-green-100 text-green-800'
            : 'bg-gray-100 text-gray-800'
        }`}>
          {row.is_active ? 'Active' : 'Inactive'}
        </span>
      ),
    },
    {
      key: 'scope',
      header: 'Scope',
      render: (row: ReservationType) => (
        <span className="text-muted-foreground">{row.is_system || !row.tenant_id ? 'Global' : 'Tenant'}</span>
      ),
    },
    {
      key: 'usage',
      header: 'In Use',
      render: (row: ReservationType) => {
        const n = usage[row.type_key] ?? 0;
        return n > 0 ? (
          <span className="inline-flex px-2 py-1 text-xs font-medium rounded bg-blue-100 text-blue-800">
            {n} reservation{n === 1 ? '' : 's'}
          </span>
        ) : (
          <span className="text-muted-foreground text-sm">—</span>
        );
      },
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (row: ReservationType) => (
        <div className="flex gap-2">
          {!row.is_system && row.tenant_id && (
            <>
              <button
                onClick={() => setEditingType(row)}
                className="text-slate-600 hover:text-slate-900 text-sm font-medium"
              >
                Edit
              </button>
              <button
                onClick={() => handleToggleActive(row)}
                className="text-orange-600 hover:text-orange-800 text-sm font-medium"
              >
                {row.is_active ? 'Deactivate' : 'Activate'}
              </button>
              <button
                onClick={() => handleDelete(row)}
                className="text-red-600 hover:text-red-800 text-sm font-medium"
              >
                Delete
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

  const filterConfig = [
    {
      key: 'search',
      label: 'Search',
      type: 'search' as const,
      placeholder: 'Type name or key...',
    },
  ];

  const filteredTypes = types.filter((type) => {
    if (filters.search) {
      const term = filters.search.toLowerCase();
      return (
        type.display_name.toLowerCase().includes(term) ||
        type.type_key.toLowerCase().includes(term)
      );
    }
    return true;
  });

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Reservation Types"
          description="Manage reservation type options (Job, Project, Customer Order, etc.). Add tenant-specific types for your workflows."
          actions={
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              + Add Reservation Type
            </button>
          }
        />

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex gap-2">
            <span className="text-blue-600">i</span>
            <div className="flex-1">
              <h3 className="font-medium text-blue-900">About Reservation Types</h3>
              <p className="text-sm text-blue-700 mt-1">
                Reservation types label <em>why</em> stock is reserved — they show up as the
                &quot;Allocation Type&quot; dropdown when creating a reservation, and the database rejects
                any reservation whose type isn&apos;t on this list and active. Global types are provided by
                default and can&apos;t be changed; add your own custom types for tenant-specific workflows.
                Deactivating a type hides it from new reservations without touching existing ones; deleting
                is only possible when nothing references it.
              </p>
            </div>
          </div>
        </div>

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
          emptyMessage="No reservation types found"
          rowKey={(row) => row.id}
        />

        <ReservationTypeModal
          open={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            fetchTypes();
          }}
        />

        <ReservationTypeModal
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
