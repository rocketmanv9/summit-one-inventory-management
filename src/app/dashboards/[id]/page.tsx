'use client';

import { use, useState } from 'react';
import { useDashboard, useDashboardWidgets } from '@/hooks/useDashboards';
import { EditableDashboardGrid } from '@/components/dashboards/EditableDashboardGrid';
import { AddWidgetModal } from '@/components/dashboards/AddWidgetModal';
import AppShell from '@/components/layout/AppShell';
import Link from 'next/link';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function DashboardViewPage({ params }: PageProps) {
  const { id } = use(params);
  const { dashboard, loading: dashboardLoading, error: dashboardError } = useDashboard(id);
  const { widgets, loading: widgetsLoading, error: widgetsError, updateWidget, deleteWidget } = useDashboardWidgets(id);
  const [isEditMode, setIsEditMode] = useState(false);
  const [showAddWidget, setShowAddWidget] = useState(false);

  const loading = dashboardLoading || widgetsLoading;
  const error = dashboardError || widgetsError;

  if (loading) {
    return (
      <AppShell>
        <div className="p-8">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-gray-200 rounded w-64"></div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-48 bg-gray-200 rounded"></div>
              ))}
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  if (error || !dashboard) {
    return (
      <AppShell>
        <div className="p-8">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-red-800">Error Loading Dashboard</h2>
            <p className="text-sm text-red-600 mt-2">
              {error?.message || 'Dashboard not found'}
            </p>
            <Link
              href="/dashboards"
              className="mt-4 inline-block text-sm text-blue-600 hover:text-blue-800"
            >
              ← Back to Dashboards
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
            <Link
              href="/dashboards"
              className="text-sm text-blue-600 hover:text-blue-800 mb-2 inline-block"
            >
              ← Back to Dashboards
            </Link>
            <h1 className="text-3xl font-bold text-gray-900">{dashboard.name}</h1>
            {dashboard.description && (
              <p className="mt-2 text-sm text-gray-600">{dashboard.description}</p>
            )}
          </div>
          
          <div className="flex items-center gap-3">
            {dashboard.is_default && (
              <span className="px-3 py-1 text-xs font-medium text-blue-800 bg-blue-100 rounded-full">
                Default
              </span>
            )}
            
            <button
              onClick={() => setShowAddWidget(true)}
              className="px-4 py-2 text-sm font-medium bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
            >
              + Add Widget
            </button>
            
            <button
              onClick={() => setIsEditMode(!isEditMode)}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                isEditMode
                  ? 'bg-gray-600 text-white hover:bg-gray-700'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {isEditMode ? 'Exit Edit Mode' : 'Edit Layout'}
            </button>
          </div>
        </div>

        {/* Widgets Grid */}
        {widgets.length === 0 ? (
          <div className="text-center py-12 bg-gray-50 rounded-lg border border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">No widgets yet</h3>
            <p className="mt-2 text-sm text-gray-600">
              Add widgets to customize this dashboard
            </p>
            <button
              onClick={() => setShowAddWidget(true)}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              Add Your First Widget
            </button>
          </div>
        ) : (
          <EditableDashboardGrid
            widgets={widgets}
            isEditMode={isEditMode}
            onWidgetUpdate={updateWidget}
            onWidgetDelete={deleteWidget}
          />
        )}

        {/* Add Widget Modal */}
        {showAddWidget && (
          <AddWidgetModal
            dashboardId={id}
            onClose={() => setShowAddWidget(false)}
            onAdded={() => {
              setShowAddWidget(false);
              window.location.reload(); // Refresh to show new widget
            }}
          />
        )}
      </div>
    </AppShell>
  );
}
