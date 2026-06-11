'use client';

import { AppError } from '@rocketmanv9/chassis/errors';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import type { DashboardWidget } from '@/types/dashboard';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { createPurchaseOrder } from '@/lib/api/purchase-orders';
import { errMessage } from '@/lib/client-errors';

export function ReplenishmentSuggestions({ widget }: { widget: DashboardWidget }) {
  const [data, setData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creatingPO, setCreatingPO] = useState<string | null>(null);
  const [createdPOs, setCreatedPOs] = useState<Record<string, string>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

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

  // Creates a real draft PO for the suggestion (POs auto-approve in this app).
  // Amazon ordering happens from the PO itself via the purchasing page's
  // PlaceOrderModal — the widget intentionally does not reimplement punchout.
  const handleCreatePO = async (item: any, rowKey: string) => {
    setCreatingPO(rowKey);
    setRowErrors((prev) => {
      const next = { ...prev };
      delete next[rowKey];
      return next;
    });
    try {
      const neededBy = new Date();
      neededBy.setDate(neededBy.getDate() + (item.lead_time_days ?? 7));

      // po_number omitted — the RPC generates it server-side (race-free).
      const { data: result, error: createError } = await createPurchaseOrder({
        vendor_id: item.preferred_vendor_id,
        delivery_method: 'ship',
        needed_by_date: neededBy.toISOString().slice(0, 10),
        cost_context: 'yard',
        delivery_location_id: item.location_id,
        notes: `Created from replenishment suggestion (${item.urgency} urgency)`,
        lines: [
          {
            catalog_item_id: item.catalog_item_id,
            qty_ordered: Math.round(item.suggested_order_qty),
            // Suggestions don't carry a cost — mirror CreatePOModal's `|| 0` fallback.
            unit_cost: 0,
          },
        ],
      });

      if (createError) throw createError;
      if (!result) throw AppError.internal('Failed to create purchase order');

      setCreatedPOs((prev) => ({ ...prev, [rowKey]: result.po_number }));
      toast.success(`Draft PO ${result.po_number} created`, {
        description: `${Math.round(item.suggested_order_qty)} × ${item.sku} from ${item.preferred_vendor_name || 'preferred vendor'}`,
      });
    } catch (err) {
      console.error('Error creating PO from suggestion:', err);
      setRowErrors((prev) => ({ ...prev, [rowKey]: errMessage(err, 'Failed to create purchase order') }));
    } finally {
      setCreatingPO(null);
    }
  };

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
      {data.map((item) => {
        const rowKey = `${item.catalog_item_id}-${item.location_id}`;
        return (
          <div key={rowKey} className="border-b pb-2 text-sm">
            <div className="flex items-center justify-between">
              <Link href={`/inventory/items/${item.catalog_item_id}`} className="flex-1 min-w-0 group">
                <div className="flex items-center gap-2">
                  <span className={`inline-flex px-1.5 py-0.5 text-xs font-medium rounded ${
                    item.urgency === 'critical' ? 'bg-red-100 text-red-800' :
                    item.urgency === 'high' ? 'bg-orange-100 text-orange-800' :
                    item.urgency === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {item.urgency}
                  </span>
                  <span className="font-medium truncate group-hover:underline">{item.item_name}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {item.sku} | Avail: {item.qty_available} | Order: {Math.round(item.suggested_order_qty)}
                  {item.days_of_stock != null && ` | ${Math.round(item.days_of_stock)}d stock`}
                </div>
              </Link>
              {item.preferred_vendor_id && (
                createdPOs[rowKey] ? (
                  <Link
                    href="/inventory/purchasing"
                    className="ml-2 shrink-0 text-xs font-medium text-green-700 hover:underline"
                  >
                    Draft PO created →
                  </Link>
                ) : (
                  <button
                    onClick={() => handleCreatePO(item, rowKey)}
                    disabled={creatingPO === rowKey}
                    className="ml-2 shrink-0 px-2 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
                  >
                    {creatingPO === rowKey ? '...' : 'PO'}
                  </button>
                )
              )}
            </div>
            {rowErrors[rowKey] && (
              <div className="mt-1 text-xs text-red-600">{rowErrors[rowKey]}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
