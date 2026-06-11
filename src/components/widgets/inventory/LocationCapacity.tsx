'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import type { DashboardWidget } from '@/types/dashboard';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { useUOMLabelMap } from '@/hooks/useGVTerms';
import { errMessage } from '@/lib/client-errors';

export function LocationCapacity({ widget }: { widget: DashboardWidget }) {
  const uomLabels = useUOMLabelMap();
  const [data, setData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      setError(null);
      try {
        const result = await InventoryRPC.getLocationUtilization();
        // Only show locations with capacity configured
        setData(result.filter((l: any) => l.max_capacity != null).slice(0, 10));
      } catch (error) {
        console.error('Error fetching location capacity:', error);
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
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-6 bg-gray-100 rounded" />
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
        No locations with capacity tracking configured
      </div>
    );
  }

  const overCapacity = data.filter((l) => l.is_over_capacity).length;

  return (
    <div className="p-4 space-y-3">
      {overCapacity > 0 && (
        <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {overCapacity} location(s) over capacity
        </div>
      )}
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {data.map((loc) => {
          const pct = loc.utilization_pct ?? 0;
          const barColor = loc.is_over_capacity
            ? 'bg-red-500'
            : pct > 80
              ? 'bg-orange-500'
              : pct > 50
                ? 'bg-yellow-500'
                : 'bg-green-500';

          return (
            <Link
              key={loc.location_id}
              href={`/inventory/locations/${loc.location_id}`}
              className="block space-y-1 rounded -mx-1 px-1 py-0.5 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium truncate">{loc.location_name}</span>
                <span className="text-xs text-muted-foreground ml-2 shrink-0">
                  {Math.round(loc.current_qty)} / {Math.round(loc.max_capacity)} {uomLabels[loc.capacity_uom_term_id] || ''}
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className={`h-2 rounded-full ${barColor} transition-all`}
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>
              <div className="text-xs text-right text-muted-foreground">{pct}%</div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
