'use client';

import { useState, useEffect } from 'react';
import type { DashboardWidget, WidgetData } from '@/types/dashboard';
import { getWidgetComponent } from './WidgetRegistry';
import { createClient } from '@/supabase/client';

interface WidgetContainerProps {
  widget: DashboardWidget;
}

export function WidgetContainer({ widget }: WidgetContainerProps) {
  const [data, setData] = useState<WidgetData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const supabase = createClient();

  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      setError(null);

      try {
        // Route to appropriate data fetcher based on widget key
        const widgetData = await fetchWidgetData(widget);
        setData(widgetData);
      } catch (e) {
        console.error(`Error fetching data for widget ${widget.widget_key}:`, e);
        setError(e as Error);
      } finally {
        setIsLoading(false);
      }
    }

    fetchData();

    // Set up auto-refresh if configured
    let interval: NodeJS.Timeout | null = null;
    if (widget.refresh_seconds && widget.refresh_seconds > 0) {
      interval = setInterval(fetchData, widget.refresh_seconds * 1000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [widget.widget_key, widget.config]);

  async function fetchWidgetData(widget: DashboardWidget): Promise<WidgetData> {
    const { widget_key, config } = widget;

    // Inventory Metrics
    if (widget_key === 'inv_total_value') {
      const { data } = await supabase.rpc('get_inventory_total_value');
      return { value: data || 0, trend: 'neutral' };
    }

    if (widget_key === 'inv_total_items') {
      const { data } = await supabase
        .from('inventory_read_model')
        .select('quantity_on_hand', { count: 'exact', head: true });
      return { value: data?.length || 0, trend: 'neutral' };
    }

    if (widget_key === 'inv_unique_skus') {
      const { count } = await supabase
        .from('inventory_read_model')
        .select('*', { count: 'exact', head: true });
      return { value: count || 0, trend: 'neutral' };
    }

    if (widget_key === 'inv_stockout_items') {
      const { count } = await supabase
        .from('inventory_read_model')
        .select('*', { count: 'exact', head: true })
        .lte('quantity_on_hand', 0);
      return { value: count || 0, trend: count && count > 0 ? 'down' : 'neutral' };
    }

    if (widget_key === 'inv_low_stock_items') {
      const { count } = await supabase
        .from('inventory_read_model')
        .select('*', { count: 'exact', head: true })
        .lte('quantity_on_hand', supabase.rpc('reorder_point'));
      return { value: count || 0, trend: count && count > 0 ? 'down' : 'neutral' };
    }

    // Inventory Tables
    if (widget_key === 'inv_top_value_items') {
      const { data } = await supabase
        .from('inventory_read_model')
        .select('sku, description, quantity_on_hand, unit_cost')
        .order('unit_cost', { ascending: false })
        .limit(config?.limit || 10);

      return {
        columns: [
          { key: 'sku', label: 'SKU' },
          { key: 'description', label: 'Description' },
          { key: 'quantity_on_hand', label: 'Qty' },
          { key: 'unit_cost', label: 'Unit Cost' },
        ],
        rows: data || [],
      };
    }

    if (widget_key === 'inv_stock_alerts_list') {
      const { data } = await supabase
        .from('inventory_read_model')
        .select('sku, description, quantity_on_hand')
        .lte('quantity_on_hand', 0)
        .order('quantity_on_hand', { ascending: true })
        .limit(config?.limit || 10);

      return {
        columns: [
          { key: 'sku', label: 'SKU' },
          { key: 'description', label: 'Description' },
          { key: 'quantity_on_hand', label: 'Qty on Hand' },
        ],
        rows: data || [],
      };
    }

    // Flow Metrics
    if (widget_key === 'flow_receipts_today') {
      const today = new Date().toISOString().split('T')[0];
      const { data } = await supabase
        .from('inventory_event_ledger')
        .select('quantity', { count: 'exact' })
        .eq('event_type', 'RECEIPT')
        .gte('occurred_at', `${today}T00:00:00`)
        .lte('occurred_at', `${today}T23:59:59`);

      const total = data?.reduce((sum, item) => sum + (item.quantity || 0), 0) || 0;
      return { value: total, trend: 'neutral' };
    }

    // Default fallback
    return { value: '--', trend: 'neutral' };
  }

  const WidgetComponent = getWidgetComponent(widget.widget_key);

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-red-50 rounded-lg border border-red-200 p-6">
        <div className="text-center">
          <p className="text-sm font-medium text-red-800">Error loading widget</p>
          <p className="text-xs text-red-600 mt-1">{error.message}</p>
        </div>
      </div>
    );
  }

  return <WidgetComponent widget={widget} data={data} isLoading={isLoading} />;
}
