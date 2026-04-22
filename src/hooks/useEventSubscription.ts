/**
 * useEventSubscription Hook
 * 
 * Subscribe to Supply Chain and Inventory events via Supabase Realtime
 * Uses the new supply_chain.* event naming convention
 * 
 * @see EVENT_CATALOG.md for complete event list
 * @see EVENT_QUICK_REFERENCE.md for integration examples
 */

'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/supabase/client';

export interface InventoryEvent {
  id: string;
  tenant_id: string;
  event_name: string;
  event_version: number;
  payload: any;
  correlation_id?: string;
  causation_id?: string;
  actor_user_id?: string;
  created_at: string;
}

interface UseEventSubscriptionOptions {
  /** Event name pattern to subscribe to (supports wildcards via SQL LIKE) */
  eventPattern?: string;
  /** Specific event names to subscribe to */
  eventNames?: string[];
  /** Callback when event is received */
  onEvent: (event: InventoryEvent) => void;
  /** Enable subscription (default: true) */
  enabled?: boolean;
}

/**
 * Subscribe to inventory events via Supabase Realtime
 * 
 * @example Subscribe to all supply chain events
 * ```ts
 * useEventSubscription({
 *   eventPattern: 'supply_chain.%',
 *   onEvent: (event) => {
 *     console.log('Supply chain event:', event.event_name, event.payload);
 *     // Refresh widget data, update UI, etc.
 *   }
 * });
 * ```
 * 
 * @example Subscribe to specific purchase order events
 * ```ts
 * useEventSubscription({
 *   eventNames: [
 *     'supply_chain.purchase_order.approved',
 *     'supply_chain.purchase_order.received',
 *     'supply_chain.purchase_order.cancelled'
 *   ],
 *   onEvent: (event) => {
 *     // Handle PO status change
 *     refreshPurchaseOrders();
 *   }
 * });
 * ```
 * 
 * @example Subscribe to vendor events
 * ```ts
 * useEventSubscription({
 *   eventPattern: 'supply_chain.vendor.%',
 *   onEvent: (event) => {
 *     if (event.event_name === 'supply_chain.vendor.created') {
 *       toast.success(`New vendor: ${event.payload.vendor_name}`);
 *     }
 *   }
 * });
 * ```
 */
export function useEventSubscription({
  eventPattern,
  eventNames,
  onEvent,
  enabled = true,
}: UseEventSubscriptionOptions) {
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    if (!eventPattern && (!eventNames || eventNames.length === 0)) {
      console.warn('useEventSubscription: No event pattern or names provided');
      return;
    }

    const supabase = createClient();
    
    // Create channel for events_outbox table
    const channel = supabase
      .channel('inventory-events')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'inventory',
          table: 'events_outbox',
          filter: eventPattern ? `event_name=ilike.${eventPattern}` : undefined,
        },
        (payload) => {
          const event = payload.new as InventoryEvent;
          
          // If specific event names provided, filter locally
          if (eventNames && eventNames.length > 0) {
            if (!eventNames.includes(event.event_name)) {
              return;
            }
          }
          
          onEvent(event);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setIsConnected(true);
          console.log(`✅ Subscribed to events: ${eventPattern || eventNames?.join(', ')}`);
        } else if (status === 'CLOSED') {
          setIsConnected(false);
          console.log('❌ Event subscription closed');
        }
      });

    return () => {
      setIsConnected(false);
      supabase.removeChannel(channel);
    };
  }, [eventPattern, eventNames, onEvent, enabled]);

  return { isConnected };
}

/**
 * Hook for subscribing to Supply Chain events
 * 
 * @example
 * ```ts
 * useSupplyChainEvents({
 *   onVendorEvent: (event) => console.log('Vendor:', event),
 *   onPurchaseOrderEvent: (event) => refreshPOList(),
 *   onReceiptEvent: (event) => updateInventory(),
 * });
 * ```
 */
export function useSupplyChainEvents({
  onVendorEvent,
  onPurchaseOrderEvent,
  onReceiptEvent,
  enabled = true,
}: {
  onVendorEvent?: (event: InventoryEvent) => void;
  onPurchaseOrderEvent?: (event: InventoryEvent) => void;
  onReceiptEvent?: (event: InventoryEvent) => void;
  enabled?: boolean;
}) {
  useEventSubscription({
    eventPattern: 'supply_chain.%',
    onEvent: (event) => {
      if (event.event_name.startsWith('supply_chain.vendor.') && onVendorEvent) {
        onVendorEvent(event);
      } else if (event.event_name.startsWith('supply_chain.purchase_order.') && onPurchaseOrderEvent) {
        onPurchaseOrderEvent(event);
      } else if (event.event_name.startsWith('supply_chain.receipt.') && onReceiptEvent) {
        onReceiptEvent(event);
      }
    },
    enabled,
  });
}

/**
 * Hook for subscribing to Inventory stock events
 * 
 * @example
 * ```ts
 * useInventoryStockEvents({
 *   onStockChange: (event) => {
 *     console.log('Stock changed:', event.payload);
 *     refreshDashboard();
 *   }
 * });
 * ```
 */
export function useInventoryStockEvents({
  onStockChange,
  enabled = true,
}: {
  onStockChange: (event: InventoryEvent) => void;
  enabled?: boolean;
}) {
  useEventSubscription({
    eventNames: [
      'stock.replenished',
      'stock.issued',
      'stock.returned',
      'stock.adjusted',
      'stock.low_threshold_reached',
      'stock.out_of_stock',
    ],
    onEvent: onStockChange,
    enabled,
  });
}
