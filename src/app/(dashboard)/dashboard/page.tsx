'use client';

import { useDashboards } from '@/hooks/useDashboards';
import { AppShell } from '@/components/layout/AppShell';
import Link from 'next/link';
import { useState } from 'react';
import { createClient } from '@/supabase/client';
import { useRouter } from 'next/navigation';

export default function DashboardPage() {
  const { dashboards, loading, error } = useDashboards();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const router = useRouter();

  if (loading) {
    return (
      <AppShell>
        <div className="p-8">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-gray-200 rounded w-64"></div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-32 bg-gray-200 rounded"></div>
              ))}
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  if (error) {
    return (
      <AppShell>
        <div className="p-8">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-red-800">Error Loading Dashboards</h2>
            <p className="text-sm text-red-600 mt-2">{error.message}</p>
          </div>
        </div>
      </AppShell>
    );
  }

  const defaultDashboard = dashboards.find(d => d.is_default);
  const otherDashboards = dashboards.filter(d => !d.is_default);

  return (
    <AppShell>
      <div className="p-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Dashboards</h1>
          <p className="mt-2 text-sm text-gray-600">
            View and manage your custom dashboards
          </p>
        </div>

        {/* Default Dashboard */}
        {defaultDashboard && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Default Dashboard</h2>
            <Link
              href={`/dashboard/${defaultDashboard.id}`}
              className="block p-6 bg-blue-50 border-2 border-blue-200 rounded-lg hover:border-blue-400 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-xl font-semibold text-gray-900">
                    {defaultDashboard.name}
                  </h3>
                  {defaultDashboard.description && (
                    <p className="mt-2 text-sm text-gray-600">
                      {defaultDashboard.description}
                    </p>
                  )}
                </div>
                <span className="px-3 py-1 text-xs font-medium text-blue-800 bg-blue-100 rounded-full">
                  Default
                </span>
              </div>
              <div className="mt-4 text-sm text-gray-500">
                Updated {new Date(defaultDashboard.updated_at).toLocaleDateString()}
              </div>
            </Link>
          </div>
        )}

        {/* Other Dashboards */}
        {otherDashboards.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold text-gray-800 mb-4">All Dashboards</h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {otherDashboards.map((dashboard) => (
                <Link
                  key={dashboard.id}
                  href={`/dashboard/${dashboard.id}`}
                  className="block p-6 bg-white border border-gray-200 rounded-lg hover:border-gray-400 hover:shadow-md transition-all"
                >
                  <h3 className="text-lg font-semibold text-gray-900">
                    {dashboard.name}
                  </h3>
                  {dashboard.description && (
                    <p className="mt-2 text-sm text-gray-600 line-clamp-2">
                      {dashboard.description}
                    </p>
                  )}
                  <div className="mt-4 text-xs text-gray-500">
                    Updated {new Date(dashboard.updated_at).toLocaleDateString()}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Create New Dashboard Button */}
        <div className="mt-8">
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            + Create New Dashboard
          </button>
        </div>

        {/* Empty State */}
        {dashboards.length === 0 && (
          <div className="text-center py-12 bg-gray-50 rounded-lg border border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">No dashboards yet</h3>
            <p className="mt-2 text-sm text-gray-600">
              Click the button above to create your first dashboard
            </p>
          </div>
        )}

        {/* Create Dashboard Modal */}
        {showCreateModal && (
          <CreateDashboardModal
            onClose={() => setShowCreateModal(false)}
            onCreate={(id) => {
              setShowCreateModal(false);
              router.push(`/dashboard/${id}`);
            }}
          />
        )}
      </div>
    </AppShell>
  );
}

function CreateDashboardModal({ onClose, onCreate }: { onClose: () => void; onCreate: (id: string) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const supabase = createClient();

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Dashboard name is required');
      return;
    }

    setCreating(true);
    setError('');

    try {
      const response = await fetch('/api/dashboards', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          is_default: isDefault,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create dashboard');
      }

      const { data } = await response.json();
      onCreate(data.id);
    } catch (err: any) {
      console.error('Error creating dashboard:', err);
      setError(err.message || 'Failed to create dashboard');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">Create New Dashboard</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleCreate} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
              Dashboard Name *
            </label>
            <input
              type="text"
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="My Dashboard"
              required
            />
          </div>

          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Optional description..."
              rows={3}
            />
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="isDefault"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="isDefault" className="ml-2 block text-sm text-gray-700">
              Set as default dashboard
            </label>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creating ? 'Creating...' : 'Create Dashboard'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
