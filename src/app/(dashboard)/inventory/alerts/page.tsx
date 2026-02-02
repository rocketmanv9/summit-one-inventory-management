'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/FilterBar';
import { StatusChip } from '@/components/ui/StatusChip';
import { apiWrite } from '@/lib/api-client';

interface ReorderAlert {
  id: string;
  catalog_item_id: string;
  location_id: string;
  alert_type: string;
  current_qty: number;
  reorder_point: number;
  min_stock_level: number;
  target_level: number;
  suggested_order_qty: number;
  priority: string;
  status: string;
  acknowledged_at?: string;
  created_at: string;
  catalog_items?: { id: string; sku: string; name: string };
  locations?: { id: string; name: string };
  vendors?: { id: string; name: string };
}

export default function ReorderAlertsPage() {
  const [alerts, setAlerts] = useState<ReorderAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Record<string, string>>({ status: 'open' });
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchAlerts();
  }, [filters]);

  const fetchAlerts = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.status) params.set('status', filters.status);
      if (filters.priority) params.set('priority', filters.priority);

      const res = await fetch(`/api/inventory/alerts?${params}`);
      const { data } = await res.json();
      setAlerts(data || []);
    } catch (error) {
      console.error('Error fetching alerts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshAlerts = async () => {
    setRefreshing(true);
    try {
      const res = await apiWrite('/api/inventory/alerts/refresh', { method: 'POST' });
      const result = await res.json();
      
      if (res.ok) {
        alert(`Alerts updated! Created: ${result.created}, Updated: ${result.updated}, Dismissed: ${result.dismissed}`);
        fetchAlerts();
      } else {
        alert(`Error: ${result.error || 'Failed to refresh alerts'}`);
      }
    } catch (error) {
      console.error('Error refreshing alerts:', error);
      alert('Failed to refresh alerts. Please try again.');
    } finally {
      setRefreshing(false);
    }
  };

  const handleAcknowledge = async (alertId: string) => {
    try {
      const res = await apiWrite(`/api/inventory/alerts/${alertId}/acknowledge`, { method: 'POST' });
      
      if (!res.ok) {
        const result = await res.json();
        alert(`Error: ${result.error || 'Failed to acknowledge alert'}`);
        return;
      }

      alert('Alert acknowledged!');
      fetchAlerts();
    } catch (error) {
      console.error('Error acknowledging alert:', error);
      alert('Failed to acknowledge alert. Please try again.');
    }
  };

  const handleDismiss = async (alertId: string) => {
    const reason = prompt('Enter dismissal reason:');
    if (!reason) return;

    try {
      const res = await apiWrite(`/api/inventory/alerts/${alertId}/dismiss`, {
        method: 'POST',
        body: { reason }
      });

      if (!res.ok) {
        const result = await res.json();
        alert(`Error: ${result.error || 'Failed to dismiss alert'}`);
        return;
      }

      alert('Alert dismissed!');
      fetchAlerts();
    } catch (error) {
      console.error('Error dismissing alert:', error);
      alert('Failed to dismiss alert. Please try again.');
    }
  };

  const handleCreatePO = (alert: ReorderAlert) => {
    // Navigate to create PO page with pre-filled item and quantity
    window.location.href = `/inventory/purchasing/new?item_id=${alert.catalog_item_id}&qty=${alert.suggested_order_qty}&location_id=${alert.location_id}`;
  };

  const columns = [
    {
      key: 'priority',
      header: 'Priority',
      sortable: true,
      render: (row: ReorderAlert) => {
        const colors: Record<string, string> = {
          critical: 'bg-red-600',
          high: 'bg-orange-500',
          medium: 'bg-yellow-500',
          low: 'bg-blue-500',
        };
        return (
          <span className={`px-2 py-1 text-xs font-semibold text-white rounded ${colors[row.priority] || 'bg-gray-500'}`}>
            {row.priority.toUpperCase()}
          </span>
        );
      },
    },
    {
      key: 'item',
      header: 'Item',
      sortable: true,
      render: (row: ReorderAlert) => (
        <div>
          <div className="font-medium">{row.catalog_items?.name || '-'}</div>
          <div className="text-xs text-muted-foreground font-mono">{row.catalog_items?.sku}</div>
        </div>
      ),
    },
    {
      key: 'location',
      header: 'Location',
      sortable: true,
      render: (row: ReorderAlert) => (
        <span>{row.locations?.name || '-'}</span>
      ),
    },
    {
      key: 'alert_type',
      header: 'Alert Type',
      render: (row: ReorderAlert) => (
        <span className="text-sm capitalize">{row.alert_type.replace('_', ' ')}</span>
      ),
    },
    {
      key: 'current_qty',
      header: 'Current',
      sortable: true,
      className: 'text-right font-mono',
      render: (row: ReorderAlert) => (
        <span className={row.current_qty <= 0 ? 'text-red-600 font-bold' : ''}>
          {row.current_qty.toLocaleString()}
        </span>
      ),
    },
    {
      key: 'reorder_point',
      header: 'Reorder At',
      className: 'text-right font-mono',
      render: (row: ReorderAlert) => (
        <span className="text-muted-foreground">{row.reorder_point?.toLocaleString() || '-'}</span>
      ),
    },
    {
      key: 'suggested_order_qty',
      header: 'Suggested Order',
      sortable: true,
      className: 'text-right font-mono',
      render: (row: ReorderAlert) => (
        <span className="text-green-600 font-semibold">
          {row.suggested_order_qty?.toLocaleString() || '-'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: ReorderAlert) => <StatusChip status={row.status} />,
    },
    {
      key: 'created_at',
      header: 'Created',
      sortable: true,
      render: (row: ReorderAlert) => (
        <div className="text-sm">
          <div>{new Date(row.created_at).toLocaleDateString()}</div>
          <div className="text-xs text-muted-foreground">
            {new Date(row.created_at).toLocaleTimeString()}
          </div>
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (row: ReorderAlert) => {
        const isOpen = row.status === 'open';
        const isAcknowledged = row.status === 'acknowledged';

        return (
          <div className="flex flex-col gap-1 min-w-[120px]">
            {isOpen && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCreatePO(row);
                  }}
                  className="px-3 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded"
                >
                  Create PO
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAcknowledge(row.id);
                  }}
                  className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded"
                >
                  Acknowledge
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDismiss(row.id);
                  }}
                  className="px-3 py-1 text-xs bg-gray-600 hover:bg-gray-700 text-white rounded"
                >
                  Dismiss
                </button>
              </>
            )}
            {isAcknowledged && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCreatePO(row);
                  }}
                  className="px-3 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded"
                >
                  Create PO
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDismiss(row.id);
                  }}
                  className="px-3 py-1 text-xs bg-gray-600 hover:bg-gray-700 text-white rounded"
                >
                  Dismiss
                </button>
              </>
            )}
          </div>
        );
      },
    },
  ];

  const filterConfig = [
    {
      key: 'status',
      label: 'Status',
      type: 'select' as const,
      options: [
        { value: '', label: 'All' },
        { value: 'open', label: 'Open' },
        { value: 'acknowledged', label: 'Acknowledged' },
        { value: 'ordered', label: 'Ordered' },
        { value: 'dismissed', label: 'Dismissed' },
      ],
    },
    {
      key: 'priority',
      label: 'Priority',
      type: 'select' as const,
      options: [
        { value: '', label: 'All' },
        { value: 'critical', label: 'Critical' },
        { value: 'high', label: 'High' },
        { value: 'medium', label: 'Medium' },
        { value: 'low', label: 'Low' },
      ],
    },
  ];

  return (
    <AppShell>
      <div className="p-6">
        <PageHeader
          title="Reorder Alerts"
          description="Automated alerts for items below reorder points"
          actions={
            <button
              onClick={handleRefreshAlerts}
              disabled={refreshing}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
            >
              {refreshing ? 'Refreshing...' : 'Refresh Alerts'}
            </button>
          }
        />

        <div className="mt-6">
          <FilterBar
            filters={filterConfig}
            values={filters}
            onChange={(key, value) => setFilters(prev => ({ ...prev, [key]: value }))}
          />
        </div>

        <div className="mt-4">
          <DataTable
            columns={columns}
            data={alerts}
            loading={loading}
            rowKey={(row) => row.id}
            emptyMessage="No reorder alerts found"
          />
        </div>
      </div>
    </AppShell>
  );
}
