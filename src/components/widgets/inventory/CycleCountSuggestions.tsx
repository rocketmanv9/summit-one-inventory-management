'use client';

import { useState, useEffect } from 'react';
import type { DashboardWidget } from '@/types/dashboard';
import { InventoryRPC } from '@/lib/rpc/inventory';

export function CycleCountSuggestions({ widget }: { widget: DashboardWidget }) {
  const [data, setData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      try {
        const result = await InventoryRPC.getCycleCountSuggestions(10);
        setData(result);
      } catch (error) {
        console.error('Error fetching cycle count suggestions:', error);
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
              <span className="font-medium truncate">{item.item_name}</span>
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
          <div className="text-right ml-2 shrink-0 text-xs text-muted-foreground">
            {item.days_since_last_count < 999
              ? `${item.days_since_last_count}d ago`
              : 'Never counted'}
          </div>
        </div>
      ))}
    </div>
  );
}
