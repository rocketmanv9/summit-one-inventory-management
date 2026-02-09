'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
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
}

export default function ReservationTypesSettingsPage() {
  const [types, setTypes] = useState<ReservationType[]>([]);
  const [loading, setLoading] = useState(true);
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
            <span className="text-blue-600">ℹ️</span>
            <div className="flex-1">
              <h3 className="font-medium text-blue-900">About Reservation Types</h3>
              <p className="text-sm text-blue-700 mt-1">
                Global types are provided by default. Add tenant-specific types for your own naming and workflows.
                Custom types can be deactivated or deleted at any time.
              </p>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading...</div>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Key</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Scope</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {types.map((type) => (
                  <tr key={type.id} className={!type.is_active ? 'opacity-50' : ''}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="font-medium text-gray-900">{type.display_name}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <span className="bg-gray-100 px-2 py-1 rounded">{type.type_key}</span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {type.description || '—'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-medium rounded ${
                        type.is_active
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {type.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {type.is_system || !type.tenant_id ? 'Global' : 'Tenant'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm space-x-2">
                      {!type.is_system && type.tenant_id && (
                        <>
                          <button
                            onClick={() => setEditingType(type)}
                            className="text-blue-600 hover:text-blue-800"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleToggleActive(type)}
                            className="text-orange-600 hover:text-orange-800"
                          >
                            {type.is_active ? 'Deactivate' : 'Activate'}
                          </button>
                          <button
                            onClick={() => handleDelete(type)}
                            className="text-red-600 hover:text-red-800"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {showCreateModal && (
          <ReservationTypeModal
            onClose={() => setShowCreateModal(false)}
            onComplete={() => {
              setShowCreateModal(false);
              fetchTypes();
            }}
          />
        )}

        {editingType && (
          <ReservationTypeModal
            type={editingType}
            onClose={() => setEditingType(null)}
            onComplete={() => {
              setEditingType(null);
              fetchTypes();
            }}
          />
        )}
      </div>
    </AppShell>
  );
}

function ReservationTypeModal({
  type,
  onClose,
  onComplete,
}: {
  type?: ReservationType;
  onClose: () => void;
  onComplete: () => void;
}) {
  const [form, setForm] = useState({
    type_key: type?.type_key || '',
    display_name: type?.display_name || '',
    description: type?.description || '',
    sort_order: type?.sort_order?.toString() || '0',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const isEdit = !!type;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);

    try {
      if (!form.display_name.trim()) {
        throw new Error('Display name is required');
      }

      if (!form.type_key.trim()) {
        throw new Error('Type key is required');
      }

      const payload = {
        type_key: form.type_key.trim(),
        display_name: form.display_name.trim(),
        description: form.description.trim() || null,
        sort_order: parseInt(form.sort_order || '0', 10) || 0,
      };

      if (isEdit && type) {
        await InventoryRPC.updateReservationType(type.id, {
          display_name: payload.display_name,
          description: payload.description,
          sort_order: payload.sort_order,
        });
      } else {
        await InventoryRPC.createReservationType(payload);
      }

      onComplete();
    } catch (err: any) {
      setError(err.message || 'Failed to save reservation type');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full">
        <h2 className="text-xl font-semibold mb-4">
          {isEdit ? 'Edit Reservation Type' : 'Add Reservation Type'}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Display Name *</label>
            <input
              type="text"
              value={form.display_name}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Type Key *</label>
            <input
              type="text"
              value={form.type_key}
              onChange={(e) => setForm({ ...form, type_key: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="job, project, custom_label"
              disabled={isEdit}
            />
            {isEdit && (
              <p className="text-xs text-muted-foreground mt-1">Type key cannot be changed after creation.</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              rows={3}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Sort Order</label>
            <input
              type="number"
              value={form.sort_order}
              onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">
              {error}
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
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
