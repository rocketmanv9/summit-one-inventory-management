'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';

interface AssignmentType {
  id: string;
  type_key: string;
  display_name: string;
  icon?: string;
  is_system: boolean;
  is_active: boolean;
  requires_id: boolean;
  description?: string;
  sort_order: number;
}

export default function AssignmentTypesSettingsPage() {
  const [types, setTypes] = useState<AssignmentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingType, setEditingType] = useState<AssignmentType | null>(null);

  useEffect(() => {
    fetchTypes();
  }, []);

  const fetchTypes = async () => {
    setLoading(true);
    try {
      // Fetch all types (including inactive) for admin
      const res = await fetch('/api/inventory/assignment-types');
      const { data } = await res.json();
      setTypes(data || []);
    } catch (error) {
      console.error('Error fetching assignment types:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (type: AssignmentType) => {
    if (type.is_system) {
      alert('Cannot delete system assignment types. You can deactivate them instead.');
      return;
    }

    if (!confirm(`Delete assignment type "${type.display_name}"? This cannot be undone.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/inventory/assignment-types/${type.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Failed to delete assignment type');
        return;
      }

      await fetchTypes();
    } catch (error) {
      console.error('Error deleting assignment type:', error);
      alert('Failed to delete assignment type');
    }
  };

  const handleToggleActive = async (type: AssignmentType) => {
    try {
      const res = await fetch(`/api/inventory/assignment-types/${type.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !type.is_active }),
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Failed to update assignment type');
        return;
      }

      await fetchTypes();
    } catch (error) {
      console.error('Error updating assignment type:', error);
      alert('Failed to update assignment type');
    }
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Asset Assignment Types"
          description="Configure how assets can be assigned. Define categories like Employee, Crew, Vehicle, Job Site, or create custom types specific to your operations."
          actions={
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              + Add Assignment Type
            </button>
          }
        />

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex gap-2">
            <span className="text-blue-600">ℹ️</span>
            <div className="flex-1">
              <h3 className="font-medium text-blue-900">About Assignment Types</h3>
              <p className="text-sm text-blue-700 mt-1">
                Assignment types determine how assets can be assigned. System types (Employee, Vehicle, Job, Yard) cannot be deleted but can be deactivated. 
                Create custom types for your specific needs like "Crew", "Contractor", "Tool Crib", etc.
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
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">System</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {types.map((type) => (
                  <tr key={type.id} className={!type.is_active ? 'opacity-50' : ''}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {type.icon && <span className="text-lg">{type.icon}</span>}
                        <span className="font-medium text-gray-900">{type.display_name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <code className="bg-gray-100 px-2 py-1 rounded">{type.type_key}</code>
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
                      {type.is_system ? '✓ System' : '—'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm space-x-2">
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
                      {!type.is_system && (
                        <button
                          onClick={() => handleDelete(type)}
                          className="text-red-600 hover:text-red-800"
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {showCreateModal && (
          <AssignmentTypeModal
            onClose={() => setShowCreateModal(false)}
            onComplete={() => {
              setShowCreateModal(false);
              fetchTypes();
            }}
          />
        )}

        {editingType && (
          <AssignmentTypeModal
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

function AssignmentTypeModal({ 
  type, 
  onClose, 
  onComplete 
}: { 
  type?: AssignmentType;
  onClose: () => void; 
  onComplete: () => void;
}) {
  const [form, setForm] = useState({
    type_key: type?.type_key || '',
    display_name: type?.display_name || '',
    icon: type?.icon || '',
    description: type?.description || '',
    sort_order: type?.sort_order || 100,
    requires_id: type?.requires_id !== false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      const url = type 
        ? `/api/inventory/assignment-types/${type.id}`
        : '/api/inventory/assignment-types';
      
      const method = type ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
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
            {type ? 'Edit Assignment Type' : 'Create Assignment Type'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">Type Key *</label>
            <input
              type="text"
              value={form.type_key}
              onChange={(e) => setForm({ ...form, type_key: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="e.g., crew, contractor, tool_crib"
              required
              disabled={!!type} // Can't change key after creation
            />
            <p className="text-xs text-gray-500 mt-1">
              Lowercase, alphanumeric with underscores/hyphens only. Cannot be changed after creation.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Display Name *</label>
            <input
              type="text"
              value={form.display_name}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="e.g., Crew, Contractor, Tool Crib"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Icon (Optional)</label>
            <input
              type="text"
              value={form.icon}
              onChange={(e) => setForm({ ...form, icon: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="e.g., 👥 🔧 📦"
              maxLength={4}
            />
            <p className="text-xs text-gray-500 mt-1">
              Use an emoji or leave blank
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Description (Optional)</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              rows={2}
              placeholder="Brief description of when to use this assignment type"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Sort Order</label>
            <input
              type="number"
              value={form.sort_order}
              onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="100"
            />
            <p className="text-xs text-gray-500 mt-1">
              Lower numbers appear first in lists
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="requires_id"
              checked={form.requires_id}
              onChange={(e) => setForm({ ...form, requires_id: e.target.checked })}
              className="rounded border-gray-300"
            />
            <label htmlFor="requires_id" className="text-sm">
              Require ID/Reference when assigning
            </label>
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
              {saving ? 'Saving...' : type ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
