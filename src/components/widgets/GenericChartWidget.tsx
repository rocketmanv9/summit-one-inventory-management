'use client';

import { useState, useEffect } from 'react';
import { fetchWidgetData } from '@/lib/widget-data';
import type { DashboardWidget } from '@/types/dashboard';
import { BaseChartWidget } from './BaseChartWidget';

export function GenericChartWidget({ widget }: { widget: DashboardWidget }) {
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
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

  return <BaseChartWidget widget={widget} data={data} isLoading={isLoading} />;
}
