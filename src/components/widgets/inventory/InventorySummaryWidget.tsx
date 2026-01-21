/**
 * Inventory Summary Widget
 * Uses materialized view: mv_inventory_summary
 * Displays key inventory metrics
 */

'use client';

import { useEffect, useState } from 'react';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { Package, AlertTriangle, TrendingUp, DollarSign } from 'lucide-react';

interface InventorySummary {
  total_items: number;
  total_qty_on_hand: number;
  total_qty_reserved: number;
  total_qty_available: number;
  low_stock_count: number;
  out_of_stock_count: number;
  total_locations: number;
}

export function InventorySummaryWidget() {
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadSummary();
    // Auto-refresh every 30 seconds
    const interval = setInterval(loadSummary, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadSummary = async () => {
    try {
      const data = await InventoryRPC.getInventorySummary();
      setSummary(data);
      setError('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-gray-200 rounded w-32"></div>
          <div className="grid grid-cols-2 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-16 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="bg-white p-6 rounded-lg shadow-sm border border-red-200">
        <div className="flex items-center gap-2 text-red-600">
          <AlertTriangle className="h-5 w-5" />
          <span className="text-sm">{error || 'Failed to load summary'}</span>
        </div>
      </div>
    );
  }

  const metrics = [
    {
      label: 'Total Items',
      value: summary.total_items.toLocaleString(),
      icon: Package,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
    },
    {
      label: 'On Hand',
      value: summary.total_qty_on_hand.toLocaleString(),
      icon: TrendingUp,
      color: 'text-green-600',
      bgColor: 'bg-green-50',
    },
    {
      label: 'Available',
      value: summary.total_qty_available.toLocaleString(),
      icon: Package,
      color: 'text-emerald-600',
      bgColor: 'bg-emerald-50',
    },
    {
      label: 'Reserved',
      value: summary.total_qty_reserved.toLocaleString(),
      icon: DollarSign,
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
    },
    {
      label: 'Low Stock',
      value: summary.low_stock_count.toLocaleString(),
      icon: AlertTriangle,
      color: 'text-yellow-600',
      bgColor: 'bg-yellow-50',
    },
    {
      label: 'Out of Stock',
      value: summary.out_of_stock_count.toLocaleString(),
      icon: AlertTriangle,
      color: 'text-red-600',
      bgColor: 'bg-red-50',
    },
  ];

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900">Inventory Overview</h3>
        <p className="mt-1 text-sm text-gray-600">Real-time inventory metrics</p>
      </div>

      {/* Metrics Grid */}
      <div className="p-6">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {metrics.map((metric, index) => {
            const Icon = metric.icon;
            return (
              <div
                key={index}
                className="p-4 rounded-lg border border-gray-200 hover:border-blue-300 hover:shadow-md transition-all"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-600">
                    {metric.label}
                  </span>
                  <div className={`p-2 rounded-lg ${metric.bgColor}`}>
                    <Icon className={`h-4 w-4 ${metric.color}`} />
                  </div>
                </div>
                <div className={`text-2xl font-bold ${metric.color}`}>
                  {metric.value}
                </div>
              </div>
            );
          })}
        </div>

        {/* Additional Info */}
        <div className="mt-4 pt-4 border-t border-gray-200">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">Active Locations</span>
            <span className="font-semibold text-gray-900">
              {summary.total_locations}
            </span>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-6 py-3 bg-gray-50 border-t border-gray-200">
        <p className="text-xs text-gray-500">
          Auto-refreshes every 30 seconds • Last updated:{' '}
          {new Date().toLocaleTimeString()}
        </p>
      </div>
    </div>
  );
}
