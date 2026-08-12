'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import type { DashboardWidget } from '@/types/dashboard';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { errMessage } from '@/lib/client-errors';

export function InventoryForecastWidget({ widget }: { widget: DashboardWidget }) {
  const [data, setData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      setError(null);
      try {
        const result = await InventoryRPC.getInventoryForecast();
        setData(result);
      } catch (error) {
        console.error('Error fetching inventory forecast:', error);
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
        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-gray-100 rounded" />
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

  const totals = data.reduce(
    (acc, item) => ({
      on_hand: acc.on_hand + (item.total_on_hand || 0),
      reserved: acc.reserved + (item.total_reserved || 0),
      available: acc.available + (item.total_available || 0),
      incoming: acc.incoming + (item.qty_incoming_po || 0),
      demand: acc.demand + (item.future_demand || 0),
      net: acc.net + (item.net_position || 0),
    }),
    { on_hand: 0, reserved: 0, available: 0, incoming: 0, demand: 0, net: 0 }
  );

  const metrics: Array<{ label: string; value: number; color: string; href?: string }> = [
    { label: 'On Hand', value: totals.on_hand, color: 'text-blue-600', href: '/inventory/stock' },
    { label: 'Reserved', value: totals.reserved, color: 'text-orange-600', href: '/inventory/reservations' },
    { label: 'Available', value: totals.available, color: 'text-green-600', href: '/inventory/stock' },
    { label: 'Incoming POs', value: totals.incoming, color: 'text-purple-600', href: '/inventory/purchasing' },
    { label: 'Future Demand', value: totals.demand, color: 'text-red-600' },
    { label: 'Net Position', value: totals.net, color: totals.net >= 0 ? 'text-green-600' : 'text-red-600' },
  ];

  const negativeItems = data.filter(d => d.net_position < 0);

  return (
    <div className="p-4">
      <div className="grid grid-cols-3 gap-3">
        {metrics.map((m) => {
          const tile = (
            <>
              <div className="text-xs text-muted-foreground">{m.label}</div>
              <div className={`text-lg font-semibold ${m.color}`}>
                {Math.round(m.value).toLocaleString()}
              </div>
            </>
          );
          return m.href ? (
            <Link
              key={m.label}
              href={m.href}
              className="block text-center p-2 rounded bg-muted/30 hover:bg-muted/60 transition-colors"
            >
              {tile}
            </Link>
          ) : (
            <div key={m.label} className="text-center p-2 rounded bg-muted/30">
              {tile}
            </div>
          );
        })}
      </div>
      {negativeItems.length > 0 && (
        <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          <div>{negativeItems.length} item(s) have negative net position:</div>
          <ul className="mt-1 space-y-0.5">
            {negativeItems.slice(0, 3).map((item) => (
              <li key={item.catalog_item_id} className="flex items-center justify-between gap-2">
                {item.catalog_item_id ? (
                  <Link
                    href={`/inventory/items/${item.catalog_item_id}`}
                    className="font-medium truncate underline hover:text-red-900"
                  >
                    {item.item_name}
                  </Link>
                ) : (
                  <span className="font-medium truncate">{item.item_name}</span>
                )}
                <span className="shrink-0">{Math.round(item.net_position).toLocaleString()}</span>
              </li>
            ))}
          </ul>
          {negativeItems.length > 3 && (
            <div className="mt-1 text-red-600">+{negativeItems.length - 3} more</div>
          )}
        </div>
      )}
    </div>
  );
}
