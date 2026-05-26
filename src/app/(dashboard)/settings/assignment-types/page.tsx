'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/FilterBar';
import { AssignmentTypeModal } from '@/components/modals/AssignmentTypeModal';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { getStoredAccessToken, parseJwtPayload } from '@/lib/auth-token';
import { AppError } from '@rocketmanv9/chassis/errors';

interface AssignmentType {
  id: string;
  type_key: string;
  display_name: string;
  icon?: string;
  is_system: boolean;
  is_active: boolean;
  requires_id: boolean;
  description?: string | null;
  sort_order: number;
  last_event_id: string;
}

export default function AssignmentTypesSettingsPage() {
  const [types, setTypes] = useState<AssignmentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingType, setEditingType] = useState<AssignmentType | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    fetchTypes();
    checkAdminStatus();
  }, []);

  const checkAdminStatus = async () => {
    const token = getStoredAccessToken();
    const payload = token ? parseJwtPayload(token) : null;
    setIsAdmin(payload?.app_metadata?.role === 'admin');
  };

  const fetchTypes = async () => {
    setLoading(true);
    try {
      const data = await InventoryRPC.getAssignmentTypes();
      setTypes((data || []) as AssignmentType[]);
    } catch (error) {
      console.error('Error fetching assignment types:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (type: AssignmentType) => {
    if (!isAdmin) {
      alert('Admin role required');
      return;
    }

    if (type.is_system) {
      alert('Cannot delete system assignment types. You can deactivate them instead.');
      return;
    }

    if (!confirm(`Delete assignment type "${type.display_name}"? This cannot be undone.`)) {
      return;
    }

    try {
      if (!type.last_event_id) {
        throw AppError.badRequest('Missing last_event_id for this assignment type. Please refresh and try again.');
      }
      await InventoryRPC.deleteAssignmentType(type.id, type.last_event_id);
      await fetchTypes();
    } catch (error: any) {
      console.error('Error deleting assignment type:', error);
      alert(error?.message || 'Failed to delete assignment type');
    }
  };

  const handleToggleActive = async (type: AssignmentType) => {
    if (!isAdmin) {
      alert('Admin role required');
      return;
    }

    try {
      if (!type.last_event_id) {
        throw AppError.badRequest('Missing last_event_id for this assignment type. Please refresh and try again.');
      }
      await InventoryRPC.updateAssignmentType(
        type.id,
        { is_active: !type.is_active },
        type.last_event_id
      );
      await fetchTypes();
    } catch (error: any) {
      console.error('Error updating assignment type:', error);
      alert(error?.message || 'Failed to update assignment type');
    }
  };

  const columns = [
    {
      key: 'display_name',
      header: 'Type',
      sortable: true,
      render: (row: AssignmentType) => (
        <div className="flex items-center gap-2">
          {row.icon && <span className="text-lg">{row.icon}</span>}
          <span className={`font-medium ${!row.is_active ? 'opacity-50' : ''}`}>{row.display_name}</span>
        </div>
      ),
    },
    {
      key: 'type_key',
      header: 'Key',
      render: (row: AssignmentType) => (
        <code className="bg-gray-100 px-2 py-1 rounded text-xs">{row.type_key}</code>
      ),
    },
    {
      key: 'description',
      header: 'Description',
      render: (row: AssignmentType) => (
        <span className="text-muted-foreground">{row.description || '-'}</span>
      ),
    },
    {
      key: 'is_active',
      header: 'Status',
      render: (row: AssignmentType) => (
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
      key: 'is_system',
      header: 'System',
      render: (row: AssignmentType) => (
        <span className="text-muted-foreground">{row.is_system ? 'System' : '-'}</span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (row: AssignmentType) => (
        <div className="flex gap-2">
          <button
            onClick={() => setEditingType(row)}
            disabled={!isAdmin}
            className="text-primary hover:text-primary/80 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Edit
          </button>
          <button
            onClick={() => handleToggleActive(row)}
            disabled={!isAdmin}
            className="text-orange-600 hover:text-orange-800 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {row.is_active ? 'Deactivate' : 'Activate'}
          </button>
          {!row.is_system && (
            <button
              onClick={() => handleDelete(row)}
              disabled={!isAdmin}
              className="text-red-600 hover:text-red-800 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Delete
            </button>
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
          title="Asset Assignment Types"
          description="Configure how assets can be assigned. Define categories like Employee, Crew, Vehicle, Job Site, or create custom types specific to your operations."
          actions={
            <button
              onClick={() => setShowCreateModal(true)}
              disabled={!isAdmin}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              + Add Assignment Type
            </button>
          }
        />

        {!isAdmin && (
          <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-yellow-800 font-medium">Admin Access Required</p>
            <p className="text-yellow-700 text-sm mt-1">
              You are viewing assignment types in read-only mode. Only administrators can modify these settings.
            </p>
          </div>
        )}

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex gap-2">
            <span className="text-blue-600">i</span>
            <div className="flex-1">
              <h3 className="font-medium text-blue-900">About Assignment Types</h3>
              <p className="text-sm text-blue-700 mt-1">
                Assignment types determine how assets can be assigned. System types (Employee, Vehicle, Job, Yard) cannot be deleted but can be deactivated.
                Create custom types for your specific needs like "Crew", "Contractor", "Tool Crib", etc.
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
          emptyMessage="No assignment types found"
          rowKey={(row) => row.id}
        />

        <AssignmentTypeModal
          open={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            fetchTypes();
          }}
        />

        <AssignmentTypeModal
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
