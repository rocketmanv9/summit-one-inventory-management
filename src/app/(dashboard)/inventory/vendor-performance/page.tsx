'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/layout/AppShell';
import { CapabilityGate } from '@/components/access/CapabilityGate';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { authenticatedFetch } from '@/lib/api-client';
import { AppError } from '@rocketmanv9/chassis/errors';

interface VendorPerformance {
  vendor_id: string;
  vendor_name: string;
  vendor_code: string;
  is_active: boolean;
  pos_last_90_days: number;
  spend_last_90_days: number;
  on_time_delivery_rate: number;
  avg_days_late: number;
  quality_score: number;
  disputes_last_90_days: number;
  overall_rating: number;
}

interface VendorEvent {
  id: string;
  event_type: string;
  event_date: string;
  quantity: number;
  amount: number;
  days_late: number;
  metadata: any;
}

interface VendorLeadTime {
  avg_actual_days: number | null;
  p90_actual_days: number | null;
  configured_days: number | null;
  delivery_count: number;
  last_delivery_at: string | null;
}

interface VendorPriceTrend {
  catalog_item_id: string;
  item_name: string | null;
  item_sku: string | null;
  latest_cost: number | null;
  latest_at: string | null;
  trailing_avg_cost: number | null;
  pct_change: number | null;
  price_points: number;
}

interface VendorIntelligence {
  vendor_id: string;
  vendor_name: string;
  lead_time: VendorLeadTime | null;
  price_trends: VendorPriceTrend[];
}

export default function VendorPerformancePage() {
  const [vendors, setVendors] = useState<VendorPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVendor, setSelectedVendor] = useState<VendorPerformance | null>(null);
  const [vendorEvents, setVendorEvents] = useState<VendorEvent[]>([]);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [intelligence, setIntelligence] = useState<Record<string, VendorIntelligence>>({});
  const [intelLoading, setIntelLoading] = useState(true);
  const [intelError, setIntelError] = useState<string | null>(null);

  useEffect(() => {
    fetchVendorPerformance();
    fetchVendorIntelligence();
  }, []);

  const fetchVendorPerformance = async () => {
    setLoading(true);
    try {
      const res = await authenticatedFetch('/api/inventory/vendor-performance');
      const { data } = await res.json();
      setVendors(data || []);
    } catch (error) {
      console.error('Error fetching vendor performance:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchVendorIntelligence = async () => {
    setIntelLoading(true);
    setIntelError(null);
    try {
      const res = await authenticatedFetch('/api/inventory/vendor-intelligence');
      if (!res.ok) throw AppError.internal(`Request failed (${res.status})`);
      const { data } = await res.json();
      setIntelligence(data || {});
    } catch (error) {
      console.error('Error fetching vendor intelligence:', error);
      setIntelError('Could not load vendor intelligence');
    } finally {
      setIntelLoading(false);
    }
  };

  const fetchVendorEvents = async (vendorId: string) => {
    try {
      const res = await authenticatedFetch(`/api/inventory/vendor-performance/${vendorId}/events`);
      const { data } = await res.json();
      setVendorEvents(data || []);
    } catch (error) {
      console.error('Error fetching vendor events:', error);
    }
  };

  const handleViewDetails = (vendor: VendorPerformance) => {
    setSelectedVendor(vendor);
    fetchVendorEvents(vendor.vendor_id);
    setShowDetailModal(true);
  };

  const renderStars = (rating: number | null) => {
    if (!rating) return <span className="text-muted-foreground">N/A</span>;
    
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;
    
    return (
      <div className="flex items-center gap-1">
        {[...Array(5)].map((_, i) => (
          <span
            key={i}
            className={`text-lg ${
              i < fullStars
                ? 'text-yellow-500'
                : i === fullStars && hasHalfStar
                ? 'text-yellow-500 opacity-50'
                : 'text-gray-300'
            }`}
          >
            ★
          </span>
        ))}
        <span className="ml-2 text-sm font-mono">{rating.toFixed(2)}</span>
      </div>
    );
  };

  const renderPercentage = (value: number | null, goodThreshold = 0.9) => {
    if (value === null) return <span className="text-muted-foreground">N/A</span>;
    
    const percentage = (value * 100).toFixed(1);
    const colorClass = value >= goodThreshold ? 'text-green-600' : value >= 0.7 ? 'text-yellow-600' : 'text-red-600';
    
    return <span className={`font-semibold ${colorClass}`}>{percentage}%</span>;
  };

  const formatMoney = (value: number | null | undefined) => {
    if (value === null || value === undefined) return '—';
    return `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const renderLeadTime = (vendorId: string) => {
    const leadTime = intelligence[vendorId]?.lead_time;
    if (!leadTime || leadTime.avg_actual_days === null || leadTime.avg_actual_days === undefined) {
      return <span className="text-muted-foreground">—</span>;
    }
    const actual = Number(leadTime.avg_actual_days);
    const configured = leadTime.configured_days !== null && leadTime.configured_days !== undefined
      ? Number(leadTime.configured_days)
      : null;
    const overConfigured = configured !== null && configured > 0 && actual > configured * 1.25;
    return (
      <div>
        <div className={`font-mono text-sm ${overConfigured ? 'text-amber-600 font-semibold' : ''}`}>
          {actual.toFixed(1)}d ({leadTime.delivery_count} {leadTime.delivery_count === 1 ? 'delivery' : 'deliveries'})
        </div>
        <div className="text-xs text-muted-foreground">
          Configured: {configured !== null ? `${configured.toFixed(1)}d` : '—'}
        </div>
      </div>
    );
  };

  const renderPctBadge = (pctChange: number | null) => {
    if (pctChange === null || pctChange === undefined) {
      return <span className="text-muted-foreground">—</span>;
    }
    const pct = Number(pctChange);
    const badgeClass = pct > 0
      ? 'bg-red-100 text-red-800'
      : pct < 0
      ? 'bg-green-100 text-green-800'
      : 'bg-gray-100 text-gray-700';
    return (
      <span className={`px-2 py-1 rounded font-semibold ${badgeClass}`}>
        {pct > 0 ? '+' : ''}{pct.toFixed(1)}%
      </span>
    );
  };

  const priceMovers = Object.values(intelligence)
    .flatMap(v =>
      (v.price_trends || []).map(trend => ({ ...trend, vendor_name: v.vendor_name }))
    )
    .filter(trend => trend.pct_change !== null && trend.pct_change !== undefined)
    .sort((a, b) => Math.abs(Number(b.pct_change)) - Math.abs(Number(a.pct_change)))
    .slice(0, 10);

  const columns = [
    {
      key: 'vendor_name',
      header: 'Vendor',
      sortable: true,
      render: (row: VendorPerformance) => (
        <div>
          <div className="font-medium">{row.vendor_name}</div>
          <div className="text-xs text-muted-foreground font-mono">{row.vendor_code}</div>
          {!row.is_active && (
            <div className="text-xs text-red-600">Inactive</div>
          )}
        </div>
      ),
    },
    {
      key: 'overall_rating',
      header: 'Rating',
      sortable: true,
      render: (row: VendorPerformance) => renderStars(row.overall_rating),
    },
    {
      key: 'on_time_delivery_rate',
      header: 'On-Time %',
      sortable: true,
      render: (row: VendorPerformance) => renderPercentage(row.on_time_delivery_rate, 0.95),
    },
    {
      key: 'quality_score',
      header: 'Quality',
      sortable: true,
      render: (row: VendorPerformance) => renderPercentage(row.quality_score, 0.98),
    },
    {
      key: 'pos_last_90_days',
      header: 'POs (90d)',
      sortable: true,
      className: 'text-right font-mono',
      render: (row: VendorPerformance) => row.pos_last_90_days,
    },
    {
      key: 'spend_last_90_days',
      header: 'Spend (90d)',
      sortable: true,
      className: 'text-right font-mono',
      render: (row: VendorPerformance) => (
        <span className="font-semibold">
          ${(row.spend_last_90_days || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </span>
      ),
    },
    {
      key: 'avg_days_late',
      header: 'Avg Days Late',
      sortable: true,
      className: 'text-right font-mono',
      render: (row: VendorPerformance) => {
        const days = row.avg_days_late || 0;
        const colorClass = days === 0 ? 'text-green-600' : days <= 3 ? 'text-yellow-600' : 'text-red-600';
        return <span className={colorClass}>{days.toFixed(1)}</span>;
      },
    },
    {
      key: 'lead_time',
      header: 'Actual Lead Time',
      render: (row: VendorPerformance) => renderLeadTime(row.vendor_id),
    },
    {
      key: 'disputes_last_90_days',
      header: 'Disputes',
      sortable: true,
      className: 'text-right',
      render: (row: VendorPerformance) => {
        const count = row.disputes_last_90_days || 0;
        return count > 0 ? (
          <span className="px-2 py-1 bg-red-100 text-red-800 rounded font-semibold">{count}</span>
        ) : (
          <span className="text-muted-foreground">0</span>
        );
      },
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (row: VendorPerformance) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleViewDetails(row);
          }}
          className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded"
        >
          View Details
        </button>
      ),
    },
  ];

  return (
    <AppShell>
      <CapabilityGate capability="vendor_performance.view" mode="page">
      <div className="p-6">
        <PageHeader
          title="Vendor Performance Analytics"
          description="Track vendor reliability, quality, and delivery performance"
        />

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
          <div className="bg-white p-4 rounded-lg border">
            <div className="text-sm text-muted-foreground">Active Vendors</div>
            <div className="text-2xl font-bold mt-1">
              {vendors.filter(v => v.is_active).length}
            </div>
          </div>
          <div className="bg-white p-4 rounded-lg border">
            <div className="text-sm text-muted-foreground">Avg Rating</div>
            <div className="text-2xl font-bold mt-1">
              {vendors.length > 0
                ? (vendors.reduce((sum, v) => sum + (v.overall_rating || 0), 0) / vendors.filter(v => v.overall_rating).length).toFixed(2)
                : 'N/A'}
              <span className="text-yellow-500 ml-1">★</span>
            </div>
          </div>
          <div className="bg-white p-4 rounded-lg border">
            <div className="text-sm text-muted-foreground">Avg On-Time Rate</div>
            <div className="text-2xl font-bold mt-1">
              {vendors.length > 0
                ? ((vendors.reduce((sum, v) => sum + (v.on_time_delivery_rate || 0), 0) / vendors.filter(v => v.on_time_delivery_rate).length) * 100).toFixed(1)
                : '0'}
              <span className="text-sm">%</span>
            </div>
          </div>
          <div className="bg-white p-4 rounded-lg border">
            <div className="text-sm text-muted-foreground">Total Spend (90d)</div>
            <div className="text-2xl font-bold mt-1">
              ${vendors.reduce((sum, v) => sum + (v.spend_last_90_days || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 0 })}
            </div>
          </div>
        </div>

        {/* Price Movers */}
        <div className="mt-6 bg-white rounded-lg border">
          <div className="px-4 py-3 border-b">
            <h3 className="font-semibold">Price Movers</h3>
            <p className="text-xs text-muted-foreground">
              Largest price changes vs the trailing 30–120 day average, across all vendors
            </p>
          </div>
          {intelLoading ? (
            <div className="p-4 text-sm text-muted-foreground">Loading price intelligence...</div>
          ) : intelError ? (
            <div className="p-4 text-sm text-red-600">{intelError}</div>
          ) : priceMovers.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">
              No significant price movement detected (insufficient purchase history).
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left">Item</th>
                    <th className="px-4 py-2 text-left">Vendor</th>
                    <th className="px-4 py-2 text-right">Latest Cost</th>
                    <th className="px-4 py-2 text-right">Trailing Avg</th>
                    <th className="px-4 py-2 text-right">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {priceMovers.map(mover => (
                    <tr key={`${mover.catalog_item_id}-${mover.vendor_name}`} className="border-t">
                      <td className="px-4 py-2">
                        <Link
                          href={`/inventory/items/${mover.catalog_item_id}`}
                          className="font-medium text-blue-600 hover:underline"
                        >
                          {mover.item_name || 'Unknown item'}
                        </Link>
                        {mover.item_sku && (
                          <div className="text-xs text-muted-foreground font-mono">{mover.item_sku}</div>
                        )}
                      </td>
                      <td className="px-4 py-2">{mover.vendor_name}</td>
                      <td className="px-4 py-2 text-right font-mono">
                        {formatMoney(mover.latest_cost)}
                        {mover.latest_at && (
                          <div className="text-xs text-muted-foreground">
                            {new Date(mover.latest_at).toLocaleDateString()}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right font-mono">{formatMoney(mover.trailing_avg_cost)}</td>
                      <td className="px-4 py-2 text-right">{renderPctBadge(mover.pct_change)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Vendor Performance Table */}
        <div className="mt-6">
          <DataTable
            columns={columns}
            data={vendors}
            loading={loading}
            rowKey={(row) => row.vendor_id}
            onRowClick={handleViewDetails}
          />
        </div>

        {/* Detail Modal */}
        {showDetailModal && selectedVendor && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-4xl w-full max-h-[80vh] overflow-y-auto">
              <h3 className="text-lg font-semibold mb-4">
                {selectedVendor.vendor_name} - Performance Details
              </h3>

              {/* Metrics Grid */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
                <div className="p-3 bg-gray-50 rounded">
                  <div className="text-xs text-muted-foreground">Overall Rating</div>
                  <div className="mt-1">{renderStars(selectedVendor.overall_rating)}</div>
                </div>
                <div className="p-3 bg-gray-50 rounded">
                  <div className="text-xs text-muted-foreground">On-Time Delivery</div>
                  <div className="mt-1 text-lg font-semibold">
                    {renderPercentage(selectedVendor.on_time_delivery_rate, 0.95)}
                  </div>
                </div>
                <div className="p-3 bg-gray-50 rounded">
                  <div className="text-xs text-muted-foreground">Quality Score</div>
                  <div className="mt-1 text-lg font-semibold">
                    {renderPercentage(selectedVendor.quality_score, 0.98)}
                  </div>
                </div>
                <div className="p-3 bg-gray-50 rounded">
                  <div className="text-xs text-muted-foreground">POs (90 days)</div>
                  <div className="mt-1 text-lg font-semibold">{selectedVendor.pos_last_90_days}</div>
                </div>
                <div className="p-3 bg-gray-50 rounded">
                  <div className="text-xs text-muted-foreground">Total Spend (90 days)</div>
                  <div className="mt-1 text-lg font-semibold font-mono">
                    ${selectedVendor.spend_last_90_days?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </div>
                </div>
                <div className="p-3 bg-gray-50 rounded">
                  <div className="text-xs text-muted-foreground">Avg Days Late</div>
                  <div className="mt-1 text-lg font-semibold">
                    {selectedVendor.avg_days_late?.toFixed(1) || '0.0'}
                  </div>
                </div>
                <div className="p-3 bg-gray-50 rounded">
                  <div className="text-xs text-muted-foreground">Actual Lead Time</div>
                  <div className="mt-1">{renderLeadTime(selectedVendor.vendor_id)}</div>
                </div>
              </div>

              {/* Price Trends */}
              {(intelligence[selectedVendor.vendor_id]?.price_trends?.length || 0) > 0 && (
                <div className="mb-6">
                  <h4 className="font-medium mb-2">Price Trends</h4>
                  <div className="max-h-48 overflow-y-auto border rounded">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left">Item</th>
                          <th className="px-3 py-2 text-right">Latest Cost</th>
                          <th className="px-3 py-2 text-right">Trailing Avg</th>
                          <th className="px-3 py-2 text-right">Change</th>
                        </tr>
                      </thead>
                      <tbody>
                        {intelligence[selectedVendor.vendor_id].price_trends.map(trend => (
                          <tr key={trend.catalog_item_id} className="border-t">
                            <td className="px-3 py-2">
                              <Link
                                href={`/inventory/items/${trend.catalog_item_id}`}
                                className="text-blue-600 hover:underline"
                              >
                                {trend.item_name || 'Unknown item'}
                              </Link>
                              {trend.item_sku && (
                                <span className="ml-2 text-xs text-muted-foreground font-mono">
                                  {trend.item_sku}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right font-mono">{formatMoney(trend.latest_cost)}</td>
                            <td className="px-3 py-2 text-right font-mono">{formatMoney(trend.trailing_avg_cost)}</td>
                            <td className="px-3 py-2 text-right">{renderPctBadge(trend.pct_change)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Recent Events */}
              <div className="mb-4">
                <h4 className="font-medium mb-2">Recent Activity</h4>
                <div className="max-h-60 overflow-y-auto border rounded">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left">Date</th>
                        <th className="px-3 py-2 text-left">Event</th>
                        <th className="px-3 py-2 text-right">Quantity</th>
                        <th className="px-3 py-2 text-right">Amount</th>
                        <th className="px-3 py-2 text-right">Days Late</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vendorEvents.map(event => (
                        <tr key={event.id} className="border-t">
                          <td className="px-3 py-2">
                            {new Date(event.event_date).toLocaleDateString()}
                          </td>
                          <td className="px-3 py-2">
                            <span className="capitalize">{event.event_type.replace('_', ' ')}</span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {event.quantity?.toLocaleString() || '-'}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {event.amount ? `$${event.amount.toLocaleString()}` : '-'}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {event.days_late > 0 ? (
                              <span className="text-red-600">{event.days_late}</span>
                            ) : (
                              '-'
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowDetailModal(false)}
                  className="px-4 py-2 text-sm bg-gray-200 hover:bg-gray-300 rounded"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      </CapabilityGate>
    </AppShell>
  );
}
