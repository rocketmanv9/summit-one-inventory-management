'use client';

import { useParams } from 'next/navigation';
import { useDashboard, useDashboardWidgets } from '@/hooks/useDashboards';
import { AppShell } from '@/components/layout/AppShell';
import { EditableDashboardGrid } from '@/components/dashboards/EditableDashboardGrid';
import { AddWidgetModal } from '@/components/dashboards/AddWidgetModal';
import { useState } from 'react';
import Link from 'next/link';

export default function DashboardDetailPage() {
  const params = useParams();
  const dashboardId = params.id as string;
  const { dashboard, loading: dashboardLoading, error: dashboardError } = useDashboard(dashboardId);
  const { 
    widgets, 
    loading: widgetsLoading, 
    error: widgetsError,
    updateWidget,
    deleteWidget 
  } = useDashboardWidgets(dashboardId);
  const [showAddWidget, setShowAddWidget] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

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
      <div className="p-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Link
                href="/dashboard"
                className="text-gray-500 hover:text-gray-700"
              >
                ← Back
              </Link>
              <h1 className="text-3xl font-bold text-gray-900">{dashboard.name}</h1>
              {dashboard.is_default && (
                <span className="px-3 py-1 text-xs font-medium text-blue-800 bg-blue-100 rounded-full">
                  Default
                </span>
              )}
            </div>
            {dashboard.description && (
              <p className="text-sm text-gray-600">{dashboard.description}</p>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setIsEditMode(!isEditMode)}
              className={`px-4 py-2 rounded-md transition-colors ${
                isEditMode
                  ? 'bg-gray-600 text-white hover:bg-gray-700'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              {isEditMode ? '✓ Done Editing' : '✏️ Edit Layout'}
            </button>
            <button
              onClick={() => setShowAddWidget(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              + Add Widget
            </button>
          </div>
        </div>

        {/* Dashboard Grid */}
        {widgets.length > 0 ? (
          <EditableDashboardGrid
            key={refreshKey}
            dashboardId={dashboardId}
            widgets={widgets}
            isEditMode={isEditMode}
            onWidgetUpdate={updateWidget}
            onWidgetDelete={deleteWidget}
          />
        ) : (
          /* Empty State */
          <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
            <h3 className="text-lg font-medium text-gray-900">No widgets yet</h3>
            <p className="mt-2 text-sm text-gray-600">
              Add your first widget to start building your dashboard
            </p>
            <button
              onClick={() => setShowAddWidget(true)}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              + Add Widget
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
              setRefreshKey(prev => prev + 1);
              window.location.reload(); // Force refresh to get new widgets
            }}
          />
        )}
      </div>
    </AppShell>
  );
}
