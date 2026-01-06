'use client';

import { useDashboards } from '@/hooks/useDashboards';
import AppShell from '@/components/layout/AppShell';
import Link from 'next/link';

export default function DashboardsPage() {
  const { dashboards, loading, error } = useDashboards();

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
              href={`/dashboards/${defaultDashboard.id}`}
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
                  href={`/dashboards/${dashboard.id}`}
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

        {/* Empty State */}
        {dashboards.length === 0 && (
          <div className="text-center py-12 bg-gray-50 rounded-lg border border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">No dashboards yet</h3>
            <p className="mt-2 text-sm text-gray-600">
              Create your first dashboard to get started
            </p>
            <button className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors">
              Create Dashboard
            </button>
          </div>
        )}
      </div>
    </AppShell>
  );
}
