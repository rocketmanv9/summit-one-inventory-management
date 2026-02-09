'use client';

import { useState, useEffect } from 'react';
import { fetchWidgetData } from '@/lib/widget-data';
import type { DashboardWidget } from '@/types/dashboard';
import { BaseMetricWidget } from '../BaseMetricWidget';

export function TotalInventoryValue({ widget }: { widget: DashboardWidget }) {
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      try {
        const result = await fetchWidgetData({
          widget_key: widget.widget_key,
          config: widget.config,
        });
        setData(result);
      } catch (error) {
        console.error('Error fetching widget data:', error);
      } finally {
        setIsLoading(false);
      }
    }
    fetchData();
  }, [widget.widget_key, widget.config]);

  return <BaseMetricWidget widget={widget} data={data} isLoading={isLoading} />;
}
