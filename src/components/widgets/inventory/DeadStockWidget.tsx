'use client';

import { useState, useEffect } from 'react';
import type { DashboardWidget } from '@/types/dashboard';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { errMessage } from '@/lib/client-errors';

export function DeadStockWidget({ widget }: { widget: DashboardWidget }) {
  const [data, setData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      setError(null);
      try {
        const result = await InventoryRPC.getDeadStockReport({ minDays: 90 });
        setData(result.slice(0, 10));
      } catch (error) {
        console.error('Error fetching dead stock:', error);
        setError(errMessage(error, 'Unknown error'));
      } finally {
        setIsLoading(false);
      }
    }
    fetchData();
  }, [widget.widget_key, widget.config]);

  if (isLoading) {
    return (
      <div className="p-4 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-1/3 mb-4" />
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-3 bg-gray-100 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-center text-muted-foreground text-sm">
        Failed to load — {error}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="p-4 text-center text-muted-foreground text-sm">
        No dead stock items found
      </div>
    );
  }

  const totalCapital = data.reduce((sum, item) => sum + (item.capital_locked || 0), 0);

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">Capital Locked</span>
        <span className="text-lg font-semibold">${totalCapital.toLocaleString()}</span>
      </div>
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {data.map((item) => (
          <div key={`${item.catalog_item_id}-${item.location_id}`} className="flex items-center justify-between text-sm border-b pb-1">
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{item.item_name}</div>
              <div className="text-xs text-muted-foreground">{item.sku} - {item.location_name}</div>
            </div>
            <div className="text-right ml-2 shrink-0">
              <span className={`inline-flex px-1.5 py-0.5 text-xs font-medium rounded ${
                item.aging_status === 'critical' ? 'bg-red-100 text-red-800' :
                item.aging_status === 'warning' ? 'bg-orange-100 text-orange-800' :
                'bg-yellow-100 text-yellow-800'
              }`}>
                {item.days_since_movement}d
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
