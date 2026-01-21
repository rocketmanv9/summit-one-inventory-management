/**
 * OpenPurchaseOrdersRealtime Widget
 * 
 * Real-time widget that auto-refreshes when supply chain events occur
 * Uses NEW event naming: supply_chain.purchase_order.*
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import type { DashboardWidget } from '@/types/dashboard';
import { BaseTableWidget } from '../BaseTableWidget';
import { useSupplyChainEvents } from '@/hooks/useEventSubscription';

export function OpenPurchaseOrdersRealtime({ widget }: { widget: DashboardWidget }) {
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/widgets/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ widget_key: widget.widget_key, config: widget.config }),
      });
      const result = await response.json();
      setData(result.data);
      setLastUpdate(new Date());
    } catch (error) {
      console.error('Error fetching widget data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [widget.widget_key, widget.config]);

  // Initial load
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Subscribe to supply chain events and auto-refresh
  useSupplyChainEvents({
    onPurchaseOrderEvent: (event) => {
      console.log('📦 PO Event received:', event.event_name, event.payload);
      
      // Debounce rapid events (wait 1 second before refreshing)
      setTimeout(() => {
        fetchData();
      }, 1000);
    },
    enabled: true, // Always listen for real-time updates
  });

  return (
    <div className="relative">
      <BaseTableWidget widget={widget} data={data} isLoading={isLoading} />
      
      {/* Real-time indicator */}
      <div className="absolute top-2 right-2 flex items-center gap-2 text-xs text-muted-foreground">
        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        <span>Live</span>
        <span className="text-xs opacity-50">
          Updated {lastUpdate.toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
}
