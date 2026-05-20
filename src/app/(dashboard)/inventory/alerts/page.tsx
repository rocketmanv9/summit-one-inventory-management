'use client';

import { useState, useEffect, useCallback } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/FilterBar';
import { StatusChip } from '@/components/ui/StatusChip';
import { apiWrite } from '@/lib/api-client';
import { ShoppingCart, Loader2, X, CheckCircle2, XCircle } from 'lucide-react';

const AMAZON_API = '/api/settings/integrations/amazon-business';

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

interface AmazonMapping {
  catalog_item_id: string;
  external_product_id: string;
}

interface Location {
  id: string;
  name: string;
  address_line_1?: string;
  city?: string;
  state?: string;
  postal_code?: string;
}

export default function ReorderAlertsPage() {
  const [alerts, setAlerts] = useState<ReorderAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Record<string, string>>({ status: 'open' });
  const [refreshing, setRefreshing] = useState(false);

  // Amazon ordering state
  const [amazonConnected, setAmazonConnected] = useState(false);
  const [amazonMappings, setAmazonMappings] = useState<AmazonMapping[]>([]);
  const [orderModal, setOrderModal] = useState<ReorderAlert | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [orderQty, setOrderQty] = useState(0);
  const [costEstimate, setCostEstimate] = useState<any>(null);
  const [estimating, setEstimating] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [orderResult, setOrderResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    fetchAlerts();
  }, [filters]);

  // Check Amazon connection and load mappings
  useEffect(() => {
    checkAmazonStatus();
  }, []);

  const checkAmazonStatus = async () => {
    try {
      const res = await fetch(AMAZON_API);
      const json = await res.json();
      if (json?.data?.connected) {
        setAmazonConnected(true);
        // Load mappings
        const mapRes = await fetch(`${AMAZON_API}/mappings`);
        if (mapRes.ok) {
          const mapJson = await mapRes.json();
          setAmazonMappings((mapJson?.data || []).map((m: any) => ({
            catalog_item_id: m.catalog_item_id,
            external_product_id: m.external_product_id,
          })));
        }
      }
    } catch {
      // Amazon not connected
    }
  };

  const loadLocations = useCallback(async () => {
    try {
      const res = await fetch('/api/inventory/locations?limit=100');
      if (res.ok) {
        const json = await res.json();
        setLocations(json?.data || []);
      }
    } catch {
      // Silently fail
    }
  }, []);

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
    window.location.href = `/inventory/purchasing/new?item_id=${alert.catalog_item_id}&qty=${alert.suggested_order_qty}&location_id=${alert.location_id}`;
  };

  // ── Amazon ordering ─────────────────────────────────────────────────

  const hasAmazonMapping = (catalogItemId: string) => {
    return amazonMappings.some((m) => m.catalog_item_id === catalogItemId);
  };

  const openAmazonOrder = (alertRow: ReorderAlert) => {
    setOrderModal(alertRow);
    setSelectedLocationId(alertRow.location_id);
    setOrderQty(alertRow.suggested_order_qty);
    setCostEstimate(null);
    setOrderResult(null);
    loadLocations();
  };

  const handleGetEstimate = async () => {
    if (!orderModal || !selectedLocationId) return;
    setEstimating(true);
    setCostEstimate(null);

    try {
      const res = await fetch(`${AMAZON_API}/cost-estimate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          items: [{ catalog_item_id: orderModal.catalog_item_id, qty: orderQty }],
          location_id: selectedLocationId,
        }),
      });
      const json = await res.json();

      if (!res.ok) {
        setOrderResult({ success: false, message: json?.error?.message || 'Failed to get estimate' });
        return;
      }

      setCostEstimate(json?.data?.estimate || null);
    } catch (err: unknown) {
      setOrderResult({ success: false, message: err instanceof Error ? err.message : 'Failed to get estimate' });
    } finally {
      setEstimating(false);
    }
  };

  const handlePlaceAmazonOrder = async () => {
    if (!orderModal || !selectedLocationId) return;
    setOrdering(true);
    setOrderResult(null);

    try {
      const res = await fetch(`${AMAZON_API}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          items: [{ catalog_item_id: orderModal.catalog_item_id, qty: orderQty }],
          location_id: selectedLocationId,
          label: `Reorder: ${orderModal.catalog_items?.name || orderModal.catalog_item_id}`,
        }),
      });
      const json = await res.json();

      if (!res.ok) {
        setOrderResult({ success: false, message: json?.error?.message || 'Failed to place order' });
        return;
      }

      setOrderResult({
        success: true,
        message: `PO ${json?.data?.po_number || ''} created and Amazon order placed. Amazon Order ID: ${json?.data?.amazon_order_id}`,
      });

      // Mark alert as ordered
      try {
        await apiWrite(`/api/inventory/alerts/${orderModal.id}/acknowledge`, { method: 'POST' });
      } catch {
        // Best effort
      }

      fetchAlerts();
    } catch (err: unknown) {
      setOrderResult({ success: false, message: err instanceof Error ? err.message : 'Failed to place order' });
    } finally {
      setOrdering(false);
    }
  };

  // ── Columns ─────────────────────────────────────────────────────────

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
        const showAmazon = amazonConnected && hasAmazonMapping(row.catalog_item_id);

        return (
          <div className="flex flex-col gap-1 min-w-[120px]">
            {isOpen && (
              <>
                {showAmazon && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openAmazonOrder(row);
                    }}
                    className="px-3 py-1 text-xs bg-orange-500 hover:bg-orange-600 text-white rounded flex items-center gap-1.5"
                  >
                    <ShoppingCart className="h-3 w-3" /> Order on Amazon
                  </button>
                )}
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
                {showAmazon && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openAmazonOrder(row);
                    }}
                    className="px-3 py-1 text-xs bg-orange-500 hover:bg-orange-600 text-white rounded flex items-center gap-1.5"
                  >
                    <ShoppingCart className="h-3 w-3" /> Order on Amazon
                  </button>
                )}
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

      {/* Amazon Order Modal */}
      {orderModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5 text-orange-500" />
                <h3 className="text-lg font-semibold">Create PO &amp; Order on Amazon</h3>
              </div>
              <button onClick={() => setOrderModal(null)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Item details */}
              <div className="p-3 bg-gray-50 border rounded-lg">
                <div className="font-medium">{orderModal.catalog_items?.name || 'Unknown Item'}</div>
                <div className="text-xs text-muted-foreground font-mono">{orderModal.catalog_items?.sku}</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Current stock: <span className="font-mono">{orderModal.current_qty}</span> |
                  Reorder point: <span className="font-mono">{orderModal.reorder_point}</span>
                </div>
              </div>

              {/* Quantity */}
              <div>
                <label className="block text-sm font-medium mb-1">Order Quantity</label>
                <input
                  type="number"
                  min="1"
                  value={orderQty}
                  onChange={(e) => { setOrderQty(Number(e.target.value)); setCostEstimate(null); }}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono"
                />
              </div>

              {/* Location selector */}
              <div>
                <label className="block text-sm font-medium mb-1">Delivery Location</label>
                <select
                  value={selectedLocationId}
                  onChange={(e) => { setSelectedLocationId(e.target.value); setCostEstimate(null); }}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm bg-white"
                >
                  <option value="">Select a location...</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>{loc.name}</option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground mt-1">
                  Location must have a structured address (street, city, state, zip) for Amazon shipping.
                </p>
              </div>

              {/* Get Estimate button */}
              {!costEstimate && (
                <button
                  onClick={handleGetEstimate}
                  disabled={estimating || !selectedLocationId || orderQty < 1}
                  className="w-full px-4 py-2 border border-orange-300 text-orange-700 rounded-md hover:bg-orange-50 disabled:opacity-50 text-sm flex items-center justify-center gap-2"
                >
                  {estimating ? (<><Loader2 className="h-4 w-4 animate-spin" /> Getting Estimate...</>) : 'Get Cost Estimate'}
                </button>
              )}

              {/* Cost estimate display */}
              {costEstimate && (
                <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg space-y-1 text-sm">
                  <div className="font-medium text-orange-800">Cost Estimate</div>
                  <div className="flex justify-between"><span>Subtotal:</span><span className="font-mono">${costEstimate.subtotal?.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span>Shipping:</span><span className="font-mono">${costEstimate.shipping?.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span>Tax:</span><span className="font-mono">${costEstimate.tax?.toFixed(2)}</span></div>
                  <div className="flex justify-between font-semibold border-t border-orange-200 pt-1">
                    <span>Total:</span><span className="font-mono">${costEstimate.total?.toFixed(2)}</span>
                  </div>
                </div>
              )}

              {/* Result message */}
              {orderResult && (
                <div className={`p-3 rounded-lg text-sm flex items-start gap-2 ${
                  orderResult.success
                    ? 'bg-green-50 border border-green-200 text-green-800'
                    : 'bg-red-50 border border-red-200 text-red-800'
                }`}>
                  {orderResult.success
                    ? <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                    : <XCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
                  }
                  {orderResult.message}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setOrderModal(null)}
                  className="flex-1 px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50"
                >
                  {orderResult?.success ? 'Close' : 'Cancel'}
                </button>
                {!orderResult?.success && (
                  <button
                    onClick={handlePlaceAmazonOrder}
                    disabled={ordering || !selectedLocationId || orderQty < 1}
                    className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-md hover:bg-orange-600 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {ordering ? (<><Loader2 className="h-4 w-4 animate-spin" /> Creating PO &amp; Ordering...</>) : 'Create PO & Order'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
