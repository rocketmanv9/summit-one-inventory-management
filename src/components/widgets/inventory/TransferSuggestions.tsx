'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { DashboardWidget } from '@/types/dashboard';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { errMessage } from '@/lib/client-errors';

export function TransferSuggestions({ widget, locationId }: { widget: DashboardWidget; locationId?: string }) {
  const router = useRouter();
  const [data, setData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      setError(null);
      try {
        const result = await InventoryRPC.getTransferSuggestions();
        // Transfers span two yards; when a location is active, keep only the
        // ones that move stock into or out of it. "All locations" shows every one.
        const scoped = locationId
          ? result.filter((r) => r.from_location_id === locationId || r.to_location_id === locationId)
          : result;
        setData(scoped.slice(0, 10));
      } catch (error) {
        console.error('Error fetching transfer suggestions:', error);
        setError(errMessage(error, 'Unknown error'));
      } finally {
        setIsLoading(false);
      }
    }
    fetchData();
  }, [widget.widget_key, widget.config, locationId]);

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
        No transfer optimizations found
      </div>
    );
  }

  return (
    <div className="p-4 space-y-2 max-h-64 overflow-y-auto">
      {data.map((item, idx) => (
        <div key={idx} className="text-sm border-b pb-2">
          <div className="flex items-center justify-between">
            {item.catalog_item_id ? (
              <Link
                href={`/inventory/items/${item.catalog_item_id}`}
                className="font-medium truncate hover:underline"
              >
                {item.item_name}
              </Link>
            ) : (
              <span className="font-medium truncate">{item.item_name}</span>
            )}
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
                // Open the create transfer modal with pre-filled data
                const params = new URLSearchParams({
                  create: '1',
                  from: item.from_location_id,
                  to: item.to_location_id,
                  item: item.catalog_item_id,
                  qty: String(Math.round(item.suggested_qty)),
                });
                router.push(`/inventory/transfers?${params.toString()}`);
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
