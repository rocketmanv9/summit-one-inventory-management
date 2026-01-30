/**
 * Example: Real-Time Event Subscriptions
 * 
 * This page demonstrates how to use the new supply_chain.* event names
 * for real-time dashboard updates.
 * 
 * @see /FRONTEND_EVENT_MIGRATION_GUIDE.md for migration guide
 * @see /EVENT_CATALOG.md for complete event reference
 */

export const dynamic = 'force-dynamic';

'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useSupplyChainEvents, useInventoryStockEvents, type InventoryEvent } from '@/hooks/useEventSubscription';

export default function EventSubscriptionExamplePage() {
  const [supplyChainEvents, setSupplyChainEvents] = useState<InventoryEvent[]>([]);
  const [stockEvents, setStockEvents] = useState<InventoryEvent[]>([]);
  const [eventCount, setEventCount] = useState({
    vendor: 0,
    purchaseOrder: 0,
    receipt: 0,
    stock: 0,
  });

  // Subscribe to Supply Chain events (vendor, PO, receipt)
  useSupplyChainEvents({
    onVendorEvent: (event) => {
      console.log('🏢 Vendor Event:', event.event_name, event.payload);
      setSupplyChainEvents(prev => [event, ...prev].slice(0, 20));
      setEventCount(prev => ({ ...prev, vendor: prev.vendor + 1 }));
    },
    onPurchaseOrderEvent: (event) => {
      console.log('📦 Purchase Order Event:', event.event_name, event.payload);
      setSupplyChainEvents(prev => [event, ...prev].slice(0, 20));
      setEventCount(prev => ({ ...prev, purchaseOrder: prev.purchaseOrder + 1 }));
    },
    onReceiptEvent: (event) => {
      console.log('📥 Receipt Event:', event.event_name, event.payload);
      setSupplyChainEvents(prev => [event, ...prev].slice(0, 20));
      setEventCount(prev => ({ ...prev, receipt: prev.receipt + 1 }));
    },
  });

  // Subscribe to Inventory Stock events
  useInventoryStockEvents({
    onStockChange: (event) => {
      console.log('📊 Stock Event:', event.event_name, event.payload);
      setStockEvents(prev => [event, ...prev].slice(0, 20));
      setEventCount(prev => ({ ...prev, stock: prev.stock + 1 }));
    },
  });

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Real-Time Event Subscriptions</h1>
        <p className="text-muted-foreground mt-2">
          Demonstrating the new <code className="bg-muted px-1 py-0.5 rounded">supply_chain.*</code> event naming convention
        </p>
      </div>

      {/* Event Counters */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Vendor Events</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{eventCount.vendor}</div>
            <p className="text-xs text-muted-foreground">supply_chain.vendor.*</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Purchase Order Events</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{eventCount.purchaseOrder}</div>
            <p className="text-xs text-muted-foreground">supply_chain.purchase_order.*</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Receipt Events</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{eventCount.receipt}</div>
            <p className="text-xs text-muted-foreground">supply_chain.receipt.*</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Stock Events</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{eventCount.stock}</div>
            <p className="text-xs text-muted-foreground">stock.*</p>
          </CardContent>
        </Card>
      </div>

      {/* Event Streams */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Supply Chain Events */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              Supply Chain Events (Live)
            </CardTitle>
            <CardDescription>
              Listening for vendor, PO, and receipt events
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {supplyChainEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Waiting for events... Try creating a PO or receipt to see events appear here.
                </p>
              ) : (
                supplyChainEvents.map((event, idx) => (
                  <div
                    key={`${event.id}-${idx}`}
                    className="border rounded-lg p-3 text-sm space-y-1 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <code className="text-xs font-mono font-semibold text-blue-600">
                        {event.event_name}
                      </code>
                      <Badge variant="outline" className="text-xs">
                        v{event.event_version}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(event.created_at).toLocaleString()}
                    </div>
                    {event.payload && (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                          Payload
                        </summary>
                        <pre className="mt-1 p-2 bg-muted rounded overflow-x-auto">
                          {JSON.stringify(event.payload, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Stock Events */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              Inventory Stock Events (Live)
            </CardTitle>
            <CardDescription>
              Listening for stock changes, issues, and adjustments
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {stockEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Waiting for events... Try issuing stock or posting a receipt to see events here.
                </p>
              ) : (
                stockEvents.map((event, idx) => (
                  <div
                    key={`${event.id}-${idx}`}
                    className="border rounded-lg p-3 text-sm space-y-1 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <code className="text-xs font-mono font-semibold text-green-600">
                        {event.event_name}
                      </code>
                      <Badge variant="outline" className="text-xs">
                        v{event.event_version}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(event.created_at).toLocaleString()}
                    </div>
                    {event.payload && (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                          Payload
                        </summary>
                        <pre className="mt-1 p-2 bg-muted rounded overflow-x-auto">
                          {JSON.stringify(event.payload, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Migration Notice */}
      <Card className="border-red-500/50 bg-red-50 dark:bg-red-950/10">
        <CardHeader>
          <CardTitle className="text-red-900 dark:text-red-100">
            ✅ Migration Complete - Using New Events Only
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-red-800 dark:text-red-200">
            Old event names have been <strong>removed from the system</strong>. Only the new bounded context 
            event names are emitted now (e.g., <code className="bg-red-200 dark:bg-red-900 px-1 rounded">supply_chain.purchase_order.created</code>).
          </p>
          <div className="flex gap-2 flex-wrap">
            <Badge variant="outline" className="bg-white">
              ✅ New: supply_chain.purchase_order.created
            </Badge>
            <Badge variant="outline" className="bg-white">
              ❌ Old: purchase_order.created (REMOVED)
            </Badge>
          </div>
          <p className="text-sm text-red-800 dark:text-red-200 mt-4">
            See <code className="bg-red-200 dark:bg-red-900 px-1 rounded">FRONTEND_EVENT_MIGRATION_GUIDE.md</code> for 
            complete event reference.
          </p>
        </CardContent>
      </Card>

      {/* Code Example */}
      <Card>
        <CardHeader>
          <CardTitle>Code Example</CardTitle>
          <CardDescription>
            How this page subscribes to events
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="text-xs bg-muted p-4 rounded-lg overflow-x-auto">
{`import { useSupplyChainEvents, useInventoryStockEvents } from '@/hooks/useEventSubscription';

// Subscribe to Supply Chain events
useSupplyChainEvents({
  onVendorEvent: (event) => {
    console.log('🏢 Vendor:', event.event_name);
    // Update UI
  },
  onPurchaseOrderEvent: (event) => {
    console.log('📦 PO:', event.event_name);
    // Refresh purchase orders
  },
  onReceiptEvent: (event) => {
    console.log('📥 Receipt:', event.event_name);
    // Refresh receipts and inventory
  },
});

// Subscribe to Inventory Stock events
useInventoryStockEvents({
  onStockChange: (event) => {
    console.log('📊 Stock:', event.event_name);
    // Refresh stock balances
  },
});`}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
