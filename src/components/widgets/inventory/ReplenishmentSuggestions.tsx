'use client';

import { useState, useEffect } from 'react';
import type { DashboardWidget } from '@/types/dashboard';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { errMessage } from '@/lib/client-errors';

export function ReplenishmentSuggestions({ widget }: { widget: DashboardWidget }) {
  const [data, setData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creatingPO, setCreatingPO] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      setError(null);
      try {
        const result = await InventoryRPC.getReplenishmentSuggestions();
        setData(result.slice(0, 10));
      } catch (error) {
        console.error('Error fetching replenishment suggestions:', error);
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
        No replenishment needed right now
      </div>
    );
  }

  return (
    <div className="p-4 space-y-2 max-h-64 overflow-y-auto">
      {data.map((item) => (
        <div key={`${item.catalog_item_id}-${item.location_id}`} className="flex items-center justify-between text-sm border-b pb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={`inline-flex px-1.5 py-0.5 text-xs font-medium rounded ${
                item.urgency === 'critical' ? 'bg-red-100 text-red-800' :
                item.urgency === 'high' ? 'bg-orange-100 text-orange-800' :
                item.urgency === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                'bg-gray-100 text-gray-800'
              }`}>
                {item.urgency}
              </span>
              <span className="font-medium truncate">{item.item_name}</span>
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {item.sku} | Avail: {item.qty_available} | Order: {Math.round(item.suggested_order_qty)}
              {item.days_of_stock != null && ` | ${Math.round(item.days_of_stock)}d stock`}
            </div>
          </div>
          {item.preferred_vendor_id && (
            <button
              onClick={async () => {
                setCreatingPO(item.catalog_item_id);
                try {
                  const isAmazon = item.preferred_vendor_name?.toLowerCase().includes('amazon');
                  if (isAmazon) {
                    const email = prompt('Enter your email for the Amazon punchout session:');
                    if (!email) return;
                    const locationId = prompt('Enter your delivery location ID (from Inventory > Locations):');
                    if (!locationId) return;
                    const res = await fetch('/api/settings/integrations/amazon-business/punchout/start', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
                      body: JSON.stringify({
                        user_email: email,
                        location_id: locationId,
                        catalog_items: [{ catalog_item_id: item.catalog_item_id, quantity: Math.round(item.suggested_order_qty) }],
                        suggestion_ids: [item.catalog_item_id],
                      }),
                    });
                    const json = await res.json();
                    if (json?.data?.redirect_url) {
                      window.open(json.data.redirect_url, '_blank');
                    } else {
                      alert(json?.error?.message || 'Failed to start punchout session.');
                    }
                  } else {
                    alert(`Draft PO suggestion: Order ${Math.round(item.suggested_order_qty)} ${item.sku} from ${item.preferred_vendor_name || 'preferred vendor'}`);
                  }
                } finally {
                  setCreatingPO(null);
                }
              }}
              disabled={creatingPO === item.catalog_item_id}
              className="ml-2 shrink-0 px-2 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
            >
              {creatingPO === item.catalog_item_id ? '...' : 'PO'}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
