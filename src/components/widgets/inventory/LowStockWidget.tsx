/**
 * Low Stock Alert Widget
 * Uses materialized view: mv_low_stock_summary
 * Displays items below reorder point
 */

'use client';

import { useEffect, useState } from 'react';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { AlertTriangle, AlertCircle, Package, TrendingDown } from 'lucide-react';
import Link from 'next/link';

interface LowStockItem {
  catalog_item_id: string;
  item_name: string;
  item_sku: string;
  total_on_hand: number;
  total_available: number;
  reorder_point: number;
  severity: string;
}

export function LowStockWidget() {
  const [items, setItems] = useState<LowStockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadLowStockItems();
    // Auto-refresh every 60 seconds
    const interval = setInterval(loadLowStockItems, 60000);
    return () => clearInterval(interval);
  }, []);

  const loadLowStockItems = async () => {
    try {
      const data = await InventoryRPC.getLowStockItems();
      setItems(data);
      setError('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const getSeverityColor = (severity: string) => {
    if (severity === 'critical') return 'bg-red-100 text-red-800 border-red-300';
    if (severity === 'warning') return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    return 'bg-gray-100 text-gray-800 border-gray-300';
  };

  if (loading) {
    return (
      <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-gray-200 rounded w-32"></div>
          <div className="h-3 bg-gray-200 rounded"></div>
          <div className="h-3 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white p-6 rounded-lg shadow-sm border border-red-200">
        <div className="flex items-center gap-2 text-red-600">
          <AlertCircle className="h-5 w-5" />
          <span className="text-sm">{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 bg-red-50 border-b border-red-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-600" />
            <h3 className="text-lg font-semibold text-red-900">Low Stock Alerts</h3>
          </div>
          <span className="text-2xl font-bold text-red-600">{items.length}</span>
        </div>
        <p className="mt-1 text-sm text-red-700">Items below reorder point</p>
      </div>

      {/* Content */}
      <div className="p-6">
        {items.length === 0 ? (
          <div className="text-center py-8">
            <Package className="mx-auto h-12 w-12 text-green-400" />
            <p className="mt-2 text-sm text-green-600 font-medium">
              All items are adequately stocked!
            </p>
          </div>
        ) : (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {items.slice(0, 10).map((item) => (
              <Link
                key={item.catalog_item_id}
                href={`/inventory/items/${item.catalog_item_id}`}
                className="block p-3 rounded-lg border border-gray-200 hover:border-blue-400 hover:shadow-md transition-all"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="font-medium text-gray-900">{item.item_name}</div>
                    <div className="text-sm text-gray-500">{item.item_sku}</div>
                  </div>
                  <div
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border ${getSeverityColor(
                      item.severity
                    )}`}
                  >
                    {item.severity}
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-4 text-sm">
                  <div>
                    <span className="text-gray-600">Available:</span>{' '}
                    <span className="font-semibold text-red-600">
                      {item.total_available}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-600">Reorder:</span>{' '}
                    <span className="font-semibold">{item.reorder_point}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Shortage:</span>{' '}
                    <span className="font-semibold text-red-600">
                      {item.reorder_point - item.total_available}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
            {items.length > 10 && (
              <div className="text-center pt-3 border-t">
                <Link
                  href="/inventory/alerts"
                  className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                >
                  View all {items.length} alerts →
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
