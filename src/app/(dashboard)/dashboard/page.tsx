'use client';

import { useDashboards } from '@/hooks/useDashboards';
import { AppShell } from '@/components/layout/AppShell';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { createBrowserAuthedClient } from '@/supabase/client';
import { useRouter } from 'next/navigation';
import { getStoredAccessToken, getTenantIdFromToken, getUserIdFromToken } from '@/lib/auth-token';
import { AppError } from '@rocketmanv9/chassis/errors';

export default function DashboardPage() {
  const { dashboards, loading, error } = useDashboards();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const router = useRouter();

  // Auto-redirect to default dashboard
  useEffect(() => {
    if (!loading && dashboards.length > 0) {
      const defaultDashboard = dashboards.find(d => d.is_default);
      if (defaultDashboard) {
        router.replace(`/dashboard/${defaultDashboard.id}`);
      }
    }
  }, [loading, dashboards, router]);

  if (loading) {
    return (
      <AppShell>
        <div className="p-8">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-gray-200 rounded w-64"></div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {[...Array(4)].map((_, i) => (
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
            <p className="text-sm text-red-600 mt-2">{error?.message}</p>
          </div>
        </div>
      </AppShell>
    );
  }

  const defaultDashboard = dashboards.find(d => d.is_default);
  const otherDashboards = dashboards.filter(d => !d.is_default);

  // If there's a default dashboard, show loading while redirecting
  if (defaultDashboard) {
    return (
      <AppShell>
        <div className="p-8">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-gray-200 rounded w-64"></div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-32 bg-gray-200 rounded"></div>
              ))}
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  // Only show this page if there's no default dashboard (user needs to select/create one)
  const quickActions = [
    {
      title: 'Quick Receive',
      description: 'Scan packing slip and receive items',
      icon: '📦',
      href: '/inventory/receiving',
      color: 'bg-blue-50 border-blue-200 hover:bg-blue-100'
    },
    {
      title: 'Quick PO',
      description: 'Create purchase order from vendor',
      icon: '🛒',
      href: '/inventory/purchasing',
      color: 'bg-green-50 border-green-200 hover:bg-green-100'
    },
    {
      title: 'Add Vendor + Item',
      description: 'Quick wizard for new vendor and items',
      icon: '⚡',
      onClick: () => alert('Vendor+Item wizard coming soon!'),
      color: 'bg-purple-50 border-purple-200 hover:bg-purple-100'
    },
    {
      title: 'Inventory Lookup',
      description: 'Search and view stock levels',
      icon: '🔍',
      href: '/inventory/stock',
      color: 'bg-amber-50 border-amber-200 hover:bg-amber-100'
    }
  ];

  return (
    <AppShell>
      <div className="p-8">
        {/* Quick Actions */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {quickActions.map((action) => {
              const content = (
                <>
                  <div className="text-4xl mb-3">{action.icon}</div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-1">
                    {action.title}
                  </h3>
                  <p className="text-sm text-gray-600">
                    {action.description}
                  </p>
                </>
              );

              if (action.href) {
                return (
                  <Link
                    key={action.title}
                    href={action.href}
                    className={`p-6 border rounded-lg transition-all text-left ${action.color}`}
                  >
                    {content}
                  </Link>
                );
              }

              return (
                <button
                  key={action.title}
                  type="button"
                  onClick={action.onClick}
                  className={`p-6 border rounded-lg transition-all text-left ${action.color}`}
                >
                  {content}
                </button>
              );
            })}
          </div>
        </div>

        {/* Available Dashboards */}
        {otherDashboards.length > 0 && (
          <div className="mb-8">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {otherDashboards.map((dashboard) => (
                <Link
                  key={dashboard.id}
                  href={`/dashboard/${dashboard.id}`}
                  className="block p-6 bg-white border border-gray-200 rounded-lg hover:border-blue-400 hover:shadow-md transition-all"
                >
                  <h3 className="text-lg font-semibold text-gray-900">
                    {dashboard.name}
                  </h3>
                  {dashboard.description && (
                    <p className="mt-2 text-sm text-gray-600 line-clamp-2">
                      {dashboard.description}
                    </p>
                  )}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {dashboards.length === 0 && (
          <div className="text-center py-12 bg-gray-50 rounded-lg border border-gray-200 mb-8">
            <h3 className="text-lg font-medium text-gray-900">No dashboards yet</h3>
            <p className="mt-2 text-sm text-gray-600">
              Create your first dashboard to get started
            </p>
          </div>
        )}

        {/* Create New Dashboard Button */}
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
        >
          + Create New Dashboard
        </button>

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
  const supabase = createBrowserAuthedClient();

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Dashboard name is required');
      return;
    }

    setCreating(true);
    setError('');

    try {
      const accessToken = getStoredAccessToken();
      const tenantId = accessToken ? getTenantIdFromToken(accessToken) : null;
      const userId = accessToken ? getUserIdFromToken(accessToken) : null;

      if (!tenantId) {
        throw AppError.unauthorized('Missing tenant token. Please log in again.');
      }

      const lastEventId = `ui_dashboard_${crypto.randomUUID()}`;
      const { data, error } = await supabase
        .from('dashboards')
        .upsert({
          tenant_id: tenantId,
          name: name.trim(),
          description: description.trim() || null,
          is_default: isDefault,
          scope: 'tenant',
          created_by: userId,
          owner_user_id: userId,
          last_event_id: lastEventId,
        }, {
          onConflict: 'tenant_id,last_event_id',
          ignoreDuplicates: true,
        })
        .select('id')
        .maybeSingle();

      if (error) throw error;

      if (data?.id) {
        onCreate(data.id);
        return;
      }

      const { data: existing, error: existingError } = await supabase
        .from('dashboards')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('last_event_id', lastEventId)
        .maybeSingle();

      if (existingError) throw existingError;
      if (!existing?.id) throw AppError.internal('Failed to resolve dashboard id.');
      onCreate(existing.id);
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
