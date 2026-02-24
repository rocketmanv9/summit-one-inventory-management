'use client';

import { useState, useEffect } from 'react';
import type { DashboardWidget } from '@/types/dashboard';
import { InventoryRPC } from '@/lib/rpc/inventory';

export function InventoryForecastWidget({ widget }: { widget: DashboardWidget }) {
  const [data, setData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      try {
        const result = await InventoryRPC.getInventoryForecast();
        setData(result);
      } catch (error) {
        console.error('Error fetching inventory forecast:', error);
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

  const metrics = [
    { label: 'On Hand', value: totals.on_hand, color: 'text-blue-600' },
    { label: 'Reserved', value: totals.reserved, color: 'text-orange-600' },
    { label: 'Available', value: totals.available, color: 'text-green-600' },
    { label: 'Incoming POs', value: totals.incoming, color: 'text-purple-600' },
    { label: 'Future Demand', value: totals.demand, color: 'text-red-600' },
    { label: 'Net Position', value: totals.net, color: totals.net >= 0 ? 'text-green-600' : 'text-red-600' },
  ];

  return (
    <div className="p-4">
      <div className="grid grid-cols-3 gap-3">
        {metrics.map((m) => (
          <div key={m.label} className="text-center p-2 rounded bg-muted/30">
            <div className="text-xs text-muted-foreground">{m.label}</div>
            <div className={`text-lg font-semibold ${m.color}`}>
              {Math.round(m.value).toLocaleString()}
            </div>
          </div>
        ))}
      </div>
      {data.filter(d => d.net_position < 0).length > 0 && (
        <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {data.filter(d => d.net_position < 0).length} item(s) have negative net position
        </div>
      )}
    </div>
  );
}
