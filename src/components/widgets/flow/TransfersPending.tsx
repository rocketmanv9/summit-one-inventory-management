'use client';

import { useState, useEffect } from 'react';
import { fetchWidgetData } from '@/lib/widget-data';
import type { DashboardWidget } from '@/types/dashboard';
import { BaseTableWidget } from '../BaseTableWidget';

interface TransfersPendingProps {
  widget: DashboardWidget;
}

export function TransfersPending({ widget }: TransfersPendingProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const result = await fetchWidgetData({
          widget_key: widget.widget_key,
          config: widget.config,
        });
        setData(result);
      } catch (error) {
        console.error('Error fetching transfers pending:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [widget.widget_key, widget.config]);

  return (
    <BaseTableWidget
      widget={widget}
      data={data}
      isLoading={loading}
    />
  );
}
