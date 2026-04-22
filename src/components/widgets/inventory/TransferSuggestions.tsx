'use client';

import { useState, useEffect } from 'react';
import type { DashboardWidget } from '@/types/dashboard';
import { InventoryRPC } from '@/lib/rpc/inventory';

export function TransferSuggestions({ widget }: { widget: DashboardWidget }) {
  const [data, setData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      try {
        const result = await InventoryRPC.getTransferSuggestions();
        setData(result.slice(0, 10));
      } catch (error) {
        console.error('Error fetching transfer suggestions:', error);
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
        No transfer optimizations found
      </div>
    );
  }

  return (
    <div className="p-4 space-y-2 max-h-64 overflow-y-auto">
      {data.map((item, idx) => (
        <div key={idx} className="text-sm border-b pb-2">
          <div className="flex items-center justify-between">
            <span className="font-medium truncate">{item.item_name}</span>
            <span className="text-xs text-muted-foreground ml-2 shrink-0">{item.sku}</span>
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
            <span className="text-green-600 font-medium">{item.from_location_name}</span>
            <span>({item.from_qty_available} avail)</span>
            <span className="mx-1">&rarr;</span>
            <span className="text-red-600 font-medium">{item.to_location_name}</span>
            <span>({item.to_qty_available} avail)</span>
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-xs text-muted-foreground">
              Suggest: {Math.round(item.suggested_qty)} units
            </span>
            <button
              onClick={() => {
                // Navigate to create transfer page with pre-filled data
                window.location.href = `/inventory/transfers?from=${item.from_location_id}&to=${item.to_location_id}`;
              }}
              className="px-2 py-0.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90"
            >
              Create Transfer
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
