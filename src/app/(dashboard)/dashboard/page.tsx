'use client';

import { useDashboards } from '@/hooks/useDashboards';
import { AppShell } from '@/components/layout/AppShell';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { createBrowserAuthedClient } from '@/supabase/client';
import { useRouter } from 'next/navigation';
import { getStoredAccessToken, getTenantIdFromToken, getUserIdFromToken } from '@/lib/auth-token';
import { AppError } from '@rocketmanv9/chassis/errors';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { SupplyChainRPC } from '@/lib/rpc/supply-chain';
import { authenticatedFetch } from '@/lib/api-client';
import { StatusChip } from '@/components/ui/StatusChip';
import { poBucket, poStatusChipLabel } from '@/lib/po/po-status';
import { MyAssignedCounts } from '@/components/counts/MyAssignedCounts';

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
      title: 'Quick PO',
      description: 'Create purchase order from vendor',
      icon: '🛒',
      href: '/inventory/purchasing',
      color: 'bg-green-50 border-green-200 hover:bg-green-100'
    },
    {
      title: 'Inventory Lookup',
      description: 'Search and view stock levels',
      icon: '🔍',
      href: '/inventory/stock',
      color: 'bg-amber-50 border-amber-200 hover:bg-amber-100'
    },
    {
      title: 'New Item',
      description: 'Add a new item to the catalog',
      icon: '📦',
      href: '/inventory/items/new',
      color: 'bg-blue-50 border-blue-200 hover:bg-blue-100'
    },
    {
      title: 'Transfers',
      description: 'Move inventory between locations',
      icon: '🔄',
      href: '/inventory/transfers',
      color: 'bg-purple-50 border-purple-200 hover:bg-purple-100'
    }
  ];

  return (
    <AppShell>
      <div className="p-8">
        {/* Counts assigned to me */}
        <MyAssignedCounts />

        {/* Status Overview */}
        <StatusOverview />

        {/* Quick Actions */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {quickActions.map((action) => (
              <Link
                key={action.title}
                href={action.href}
                className={`p-6 border rounded-lg transition-all text-left ${action.color}`}
              >
                <div className="text-4xl mb-3">{action.icon}</div>
                <h3 className="text-lg font-semibold text-gray-900 mb-1">
                  {action.title}
                </h3>
                <p className="text-sm text-gray-600">
                  {action.description}
                </p>
              </Link>
            ))}
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

interface LowStockRow {
  catalog_item_id: string;
  item_name: string;
  item_sku: string;
  total_available: number;
  reorder_point: number;
  severity: string;
}

interface OpenPoRow {
  id: string;
  po_number: string;
  vendor_name_snapshot?: string;
  status: string;
  created_at: string;
}

interface CycleCountRow {
  id: string;
  count_number: string;
  status: string;
  created_at: string;
  location?: { name: string };
}

/** Cycle count statuses that still need attention. */
const PENDING_COUNT_STATUSES = ['draft', 'in_progress', 'under_review'];

/**
 * Actionable status strip for the no-default-dashboard fallback view:
 * low-stock alerts, open POs, and pending cycle counts. Each card loads
 * independently so one failed source doesn't blank the others.
 */
function StatusOverview() {
  const [lowStock, setLowStock] = useState<LowStockRow[] | null>(null);
  const [lowStockError, setLowStockError] = useState(false);
  const [openPos, setOpenPos] = useState<OpenPoRow[] | null>(null);
  const [openPosError, setOpenPosError] = useState(false);
  const [pendingCounts, setPendingCounts] = useState<CycleCountRow[] | null>(null);
  const [pendingCountsError, setPendingCountsError] = useState(false);

  useEffect(() => {
    InventoryRPC.getLowStockItems()
      .then((data) => setLowStock(data || []))
      .catch((err) => {
        console.error('Error loading low stock items:', err);
        setLowStockError(true);
      });

    SupplyChainRPC.getPurchaseOrders()
      .then((data) => {
        const open = (data || []).filter((po: OpenPoRow) =>
          ['draft', 'sent', 'partially_received'].includes(poBucket(po.status))
        );
        setOpenPos(open);
      })
      .catch((err) => {
        console.error('Error loading purchase orders:', err);
        setOpenPosError(true);
      });

    authenticatedFetch('/api/inventory/cycle-counts')
      .then(async (res) => {
        if (!res.ok) throw AppError.internal('Failed to fetch cycle counts');
        const { data } = await res.json();
        setPendingCounts(
          (data || []).filter((c: CycleCountRow) => PENDING_COUNT_STATUSES.includes(c.status))
        );
      })
      .catch((err) => {
        console.error('Error loading cycle counts:', err);
        setPendingCountsError(true);
      });
  }, []);

  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Today&apos;s Status</h2>
      <div className="grid gap-4 md:grid-cols-3">
        {/* Low Stock */}
        <StatusCard
          title="Low Stock"
          count={lowStock?.length}
          countClass="text-red-600"
          loading={lowStock === null && !lowStockError}
          error={lowStockError}
          href="/inventory/stock"
          linkLabel="View stock"
          emptyText="All items are adequately stocked"
        >
          {lowStock?.slice(0, 3).map((item) => (
            <Link
              key={item.catalog_item_id}
              href={`/inventory/items/${item.catalog_item_id}`}
              className="flex items-center justify-between gap-2 py-1.5 hover:bg-gray-50 rounded px-1 -mx-1"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">{item.item_name}</div>
                <div className="text-xs text-gray-500">
                  Available <span className="font-semibold text-red-600">{item.total_available}</span>
                  {' / reorder at '}{item.reorder_point}
                </div>
              </div>
              <span
                className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${
                  item.severity === 'critical'
                    ? 'bg-red-100 text-red-800'
                    : 'bg-yellow-100 text-yellow-800'
                }`}
              >
                {item.severity}
              </span>
            </Link>
          ))}
        </StatusCard>

        {/* Open POs */}
        <StatusCard
          title="Open POs"
          count={openPos?.length}
          countClass="text-blue-600"
          loading={openPos === null && !openPosError}
          error={openPosError}
          href="/inventory/purchasing"
          linkLabel="View purchasing"
          emptyText="No open purchase orders"
        >
          {openPos?.slice(0, 3).map((po) => (
            <div key={po.id} className="flex items-center justify-between gap-2 py-1.5">
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">{po.po_number}</div>
                <div className="text-xs text-gray-500 truncate">
                  {po.vendor_name_snapshot || 'No vendor'}
                </div>
              </div>
              <StatusChip status={poStatusChipLabel(po.status)} showDot={false} />
            </div>
          ))}
        </StatusCard>

        {/* Pending Cycle Counts */}
        <StatusCard
          title="Pending Cycle Counts"
          count={pendingCounts?.length}
          countClass="text-purple-600"
          loading={pendingCounts === null && !pendingCountsError}
          error={pendingCountsError}
          href="/inventory/cycle-counts"
          linkLabel="View cycle counts"
          emptyText="No counts awaiting action"
        >
          {pendingCounts?.slice(0, 3).map((count) => (
            <div key={count.id} className="flex items-center justify-between gap-2 py-1.5">
              <div className="min-w-0">
                <div className="text-sm font-mono font-medium text-gray-900 truncate">
                  {count.count_number}
                </div>
                <div className="text-xs text-gray-500 truncate">{count.location?.name || '-'}</div>
              </div>
              <StatusChip status={count.status} showDot={false} />
            </div>
          ))}
        </StatusCard>
      </div>
    </div>
  );
}

function StatusCard({
  title,
  count,
  countClass,
  loading,
  error,
  href,
  linkLabel,
  emptyText,
  children,
}: {
  title: string;
  count?: number;
  countClass: string;
  loading: boolean;
  error: boolean;
  href: string;
  linkLabel: string;
  emptyText: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
        {!loading && !error && (
          <span className={`text-2xl font-bold ${countClass}`}>{count ?? 0}</span>
        )}
      </div>

      {loading ? (
        <div className="animate-pulse space-y-2 py-2">
          <div className="h-3 bg-gray-200 rounded"></div>
          <div className="h-3 bg-gray-200 rounded w-3/4"></div>
        </div>
      ) : error ? (
        <p className="text-sm text-red-600 py-2">Failed to load</p>
      ) : count === 0 ? (
        <p className="text-sm text-gray-500 py-2">{emptyText}</p>
      ) : (
        <div className="divide-y divide-gray-100">{children}</div>
      )}

      <Link
        href={href}
        className="mt-3 inline-block text-sm text-blue-600 hover:text-blue-800 font-medium"
      >
        {linkLabel} →
      </Link>
    </div>
  );
}

function CreateDashboardModal({ onClose, onCreate }: { onClose: () => void; onCreate: (id: string) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Dashboard name is required');
      return;
    }

    setCreating(true);
    setError('');

    try {
      const supabase = createBrowserAuthedClient();
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
