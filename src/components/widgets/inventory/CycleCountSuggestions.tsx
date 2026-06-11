'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { DashboardWidget } from '@/types/dashboard';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { errMessage } from '@/lib/client-errors';

export function CycleCountSuggestions({ widget }: { widget: DashboardWidget }) {
  const router = useRouter();
  const [data, setData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      setError(null);
      try {
        const result = await InventoryRPC.getCycleCountSuggestions(10);
        setData(result);
      } catch (error) {
        console.error('Error fetching cycle count suggestions:', error);
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
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-8 bg-gray-100 rounded" />
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
        No cycle count suggestions
      </div>
    );
  }

  return (
    <div className="p-4 space-y-2 max-h-64 overflow-y-auto">
      {data.map((item, idx) => (
        <div key={idx} className="flex items-start justify-between text-sm border-b pb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold">
                {item.priority_score}
              </span>
              {item.catalog_item_id ? (
                <Link
                  href={`/inventory/items/${item.catalog_item_id}`}
                  className="font-medium truncate hover:text-primary hover:underline"
                >
                  {item.item_name}
                </Link>
              ) : (
                <span className="font-medium truncate">{item.item_name}</span>
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5 ml-8">
              {item.sku} | {item.location_name}
              {item.abc_class && ` | ABC: ${item.abc_class}`}
            </div>
            {item.reasons && item.reasons.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1 ml-8">
                {item.reasons.map((reason: string, ri: number) => (
                  <span key={ri} className="inline-flex px-1.5 py-0.5 text-[10px] bg-gray-100 text-gray-600 rounded">
                    {reason}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-col items-end gap-1 ml-2 shrink-0">
            <div className="text-xs text-muted-foreground">
              {item.days_since_last_count < 999
                ? `${item.days_since_last_count}d ago`
                : 'Never counted'}
            </div>
            {item.location_id && (
              <button
                type="button"
                onClick={() => {
                  const params = new URLSearchParams({ create: '1', location: item.location_id });
                  if (item.catalog_item_id) params.set('item', item.catalog_item_id);
                  router.push(`/inventory/cycle-counts?${params.toString()}`);
                }}
                className="px-2 py-0.5 text-xs font-medium text-primary border border-primary/30 rounded hover:bg-primary/10 transition-colors"
              >
                Count
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
