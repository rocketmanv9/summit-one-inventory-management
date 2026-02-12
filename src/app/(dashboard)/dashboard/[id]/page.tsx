'use client';

import { useParams, useRouter } from 'next/navigation';
import { useDashboard, useDashboardWidgets, useDashboards } from '@/hooks/useDashboards';
import { AppShell } from '@/components/layout/AppShell';
import { EditableDashboardGrid } from '@/components/dashboards/EditableDashboardGrid';
import { AddWidgetModal } from '@/components/dashboards/AddWidgetModal';
import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { createBrowserAuthedClient } from '@/supabase/client';
import { getStoredAccessToken, getTenantIdFromToken, getUserIdFromToken } from '@/lib/auth-token';

export default function DashboardDetailPage() {
  const params = useParams();
  const router = useRouter();
  const dashboardId = params.id as string;
  const { dashboard, loading: dashboardLoading, error: dashboardError, refetch: refetchDashboard } = useDashboard(dashboardId);
  const { dashboards } = useDashboards();
  const {
    widgets,
    loading: widgetsLoading,
    error: widgetsError,
    updateWidget,
    deleteWidget,
    refetch
  } = useDashboardWidgets(dashboardId);
  const [showAddWidget, setShowAddWidget] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [showDashboardMenu, setShowDashboardMenu] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editedDescription, setEditedDescription] = useState('');
  const [isSavingLayout, setIsSavingLayout] = useState(false);
  const [isTogglingDefault, setIsTogglingDefault] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const supabase = createBrowserAuthedClient();

  const handleToggleDefault = async () => {
    if (!dashboard) return;
    
    setIsTogglingDefault(true);
    try {
      const accessToken = getStoredAccessToken();
      const tenantId = accessToken ? getTenantIdFromToken(accessToken) : null;
      if (!tenantId) {
        throw new Error('Missing tenant context. Please log in again.');
      }

      const lastEventId = `ui_dashboard_${crypto.randomUUID()}`;
      const { error } = await supabase
        .from('dashboards')
        .update({ is_default: !dashboard.is_default, last_event_id: lastEventId })
        .eq('id', dashboardId)
        .eq('tenant_id', tenantId)
        .is('deleted_at', null)
        .neq('last_event_id', lastEventId);

      if (error) throw error;

      refetchDashboard();
    } catch (error) {
      console.error('Error toggling default:', error);
      alert('Failed to update default status. Please try again.');
    } finally {
      setIsTogglingDefault(false);
    }
  };

  const handleDashboardDelete = () => {
    // Redirect to main dashboard page after deletion
    router.push('/dashboard');
  };

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowDashboardMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (dashboardLoading || widgetsLoading) {
    return (
      <AppShell>
        <div className="p-8">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-gray-200 rounded w-64"></div>
            <div className="h-96 bg-gray-200 rounded"></div>
          </div>
        </div>
      </AppShell>
    );
  }

  if (dashboardError || widgetsError) {
    return (
      <AppShell>
        <div className="p-8">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-red-800">Error Loading Dashboard</h2>
            <p className="text-sm text-red-600 mt-2">
              {dashboardError?.message || widgetsError?.message}
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  if (!dashboard) {
    return (
      <AppShell>
        <div className="p-8">
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-yellow-800">Dashboard Not Found</h2>
            <p className="text-sm text-yellow-600 mt-2">
              The dashboard you're looking for doesn't exist.
            </p>
            <Link
              href="/dashboard"
              className="mt-4 inline-block px-4 py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700"
            >
              Back to Dashboards
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="p-6 sm:p-8 bg-gradient-to-br from-gray-50 to-white min-h-screen">
        {/* Header */}
        <div className="mb-8 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              {/* Dashboard Switcher Dropdown */}
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setShowDashboardMenu(!showDashboardMenu)}
                  className="flex items-center gap-2 text-3xl font-bold text-gray-900 hover:text-gray-700 transition-colors"
                >
                  {dashboard.name}
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showDashboardMenu && (
                  <div className="absolute top-full left-0 mt-2 w-64 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
                    <div className="py-2">
                      <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        Switch Dashboard
                      </div>
                      {dashboards.map((d) => (
                        <Link
                          key={d.id}
                          href={`/dashboard/${d.id}`}
                          onClick={() => setShowDashboardMenu(false)}
                          className={`block px-4 py-2 text-sm hover:bg-gray-100 ${
                            d.id === dashboardId ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span>{d.name}</span>
                            {d.is_default && (
                              <span className="text-xs text-blue-600">Default</span>
                            )}
                          </div>
                        </Link>
                      ))}
                      <div className="border-t border-gray-100 mt-2 pt-2">
                        <button
                          onClick={() => {
                            setShowDashboardMenu(false);
                            setShowCreateModal(true);
                          }}
                          className="w-full px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 text-left font-medium"
                        >
                          + Create New Dashboard
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              {dashboard.is_default && (
                <span className="px-3 py-1 text-xs font-medium text-blue-800 bg-blue-100 rounded-full">
                  Default
                </span>
              )}
              {isEditMode && (
                <label className="flex items-center gap-2 px-3 py-1 bg-gray-50 border border-gray-300 rounded-md cursor-pointer hover:bg-gray-100 transition-colors">
                  <input
                    type="checkbox"
                    checked={dashboard.is_default}
                    onChange={handleToggleDefault}
                    disabled={isTogglingDefault}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500 cursor-pointer"
                  />
                  <span className="text-sm font-medium text-gray-700">
                    {isTogglingDefault ? 'Updating...' : 'Set as Default'}
                  </span>
                </label>
              )}
            </div>
            {isEditMode && isEditingDescription ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editedDescription}
                  onChange={(e) => setEditedDescription(e.target.value)}
                  placeholder="Enter dashboard description..."
                  className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={async () => {
                    const accessToken = getStoredAccessToken();
                    const tenantId = accessToken ? getTenantIdFromToken(accessToken) : null;
                    if (!tenantId) {
                      alert('Session expired. Please log in again.');
                      return;
                    }

                    const lastEventId = `ui_dashboard_${crypto.randomUUID()}`;
                    const { error } = await supabase
                      .from('dashboards')
                      .update({ description: editedDescription, last_event_id: lastEventId })
                      .eq('id', dashboardId)
                      .eq('tenant_id', tenantId)
                      .is('deleted_at', null)
                      .neq('last_event_id', lastEventId);

                    if (!error) {
                      setIsEditingDescription(false);
                      refetchDashboard();
                    }
                  }}
                  className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
                >
                  Save
                </button>
                <button
                  onClick={() => setIsEditingDescription(false)}
                  className="px-3 py-1.5 bg-gray-500 text-white text-sm rounded-md hover:bg-gray-600"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <p className="text-sm text-gray-600">
                  {dashboard.description || (isEditMode ? 'No description' : '')}
                </p>
                {isEditMode && (
                  <button
                    onClick={() => {
                      setEditedDescription(dashboard.description || '');
                      setIsEditingDescription(true);
                    }}
                    className="text-xs text-blue-600 hover:text-blue-700 underline"
                  >
                    {dashboard.description ? 'Edit' : 'Add description'}
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            {!isEditMode && (
              <button
                onClick={() => setIsEditMode(true)}
                className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Edit Layout
              </button>
            )}
            <button
              onClick={() => setShowAddWidget(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Widget
            </button>
          </div>
          </div>
        </div>

        {/* Dashboard Grid */}
        {widgets.length > 0 ? (
          <EditableDashboardGrid
            dashboardId={dashboardId}
            widgets={widgets}
            isEditMode={isEditMode}
            onWidgetUpdate={updateWidget}
            onWidgetDelete={deleteWidget}
            onLayoutSaved={() => refetch()}
            onExitEditMode={() => setIsEditMode(false)}
            onDashboardDelete={handleDashboardDelete}
          />
        ) : (
          /* Empty State */
          <div className="text-center py-16 bg-gradient-to-br from-gray-50 to-blue-50 rounded-2xl border-2 border-dashed border-blue-200 shadow-inner">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-blue-100 rounded-full mb-4">
              <svg className="w-10 h-10 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">No widgets yet</h3>
            <p className="text-sm text-gray-600 mb-6 max-w-md mx-auto">
              Start building your dashboard by adding your first widget. Choose from various data visualizations and metrics.
            </p>
            <button
              onClick={() => setShowAddWidget(true)}
              className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-all shadow-md hover:shadow-lg transform hover:scale-105 inline-flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Your First Widget
            </button>
          </div>
        )}

        {/* Add Widget Modal */}
        {showAddWidget && (
          <AddWidgetModal
            dashboardId={dashboardId}
            onClose={() => setShowAddWidget(false)}
            onAdded={() => {
              setShowAddWidget(false);
              refetch();
            }}
          />
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
        throw new Error('Missing tenant token. Please log in again.');
      }

      const lastEventId = `ui_dashboard_${crypto.randomUUID()}`;
      const { data, error } = await supabase
        .from('dashboards')
        .insert({
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
      if (!existing?.id) throw new Error('Failed to resolve dashboard id.');
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
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
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
