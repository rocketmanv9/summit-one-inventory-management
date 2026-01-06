'use client';

import { use } from 'react';
import { useDashboard, useDashboardWidgets } from '@/hooks/useDashboards';
import { WidgetContainer } from '@/components/widgets/WidgetContainer';
import AppShell from '@/components/layout/AppShell';
import Link from 'next/link';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function DashboardViewPage({ params }: PageProps) {
  const { id } = use(params);
  const { dashboard, loading: dashboardLoading, error: dashboardError } = useDashboard(id);
  const { widgets, loading: widgetsLoading, error: widgetsError } = useDashboardWidgets(id);

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

  // Calculate grid positions from widget layout
  const getGridStyle = (widget: typeof widgets[0]) => {
    if (!widget.layout) return {};
    
    const { x, y, w, h } = widget.layout;
    return {
      gridColumn: `${x + 1} / span ${w}`,
      gridRow: `${y + 1} / span ${h}`,
    };
  };

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
          
          {dashboard.is_default && (
            <span className="px-3 py-1 text-xs font-medium text-blue-800 bg-blue-100 rounded-full">
              Default
            </span>
          )}
        </div>

        {/* Widgets Grid */}
        {widgets.length === 0 ? (
          <div className="text-center py-12 bg-gray-50 rounded-lg border border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">No widgets yet</h3>
            <p className="mt-2 text-sm text-gray-600">
              Add widgets to customize this dashboard
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-12 gap-4 auto-rows-[200px]">
            {widgets.map((widget) => (
              <div
                key={widget.id}
                style={getGridStyle(widget)}
                className="min-h-0"
              >
                <WidgetContainer widget={widget} />
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
