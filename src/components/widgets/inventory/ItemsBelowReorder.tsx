'use client';

import { useState, useEffect } from 'react';
import type { DashboardWidget } from '@/types/dashboard';
import { BaseTableWidget } from '../BaseTableWidget';

export function ItemsBelowReorder({ widget }: { widget: DashboardWidget }) {
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      try {
        const response = await fetch('/api/widgets/data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ widget_key: widget.widget_key, config: widget.config }),
        });
        const result = await response.json();
        setData(result.data);
      } catch (error) {
        console.error('Error fetching widget data:', error);
      } finally {
        setIsLoading(false);
      }
    }
    fetchData();
  }, [widget.widget_key, widget.config]);

  return <BaseTableWidget widget={widget} data={data} isLoading={isLoading} />;
}
