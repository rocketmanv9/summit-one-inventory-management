'use client';

import { useState, useEffect } from 'react';
import type { DashboardWidget } from '@/types/dashboard';
import { BaseTableWidget } from '../BaseTableWidget';

interface ReceivingTodayProps {
  widget: DashboardWidget;
}

export function ReceivingToday({ widget }: ReceivingTodayProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/api/widgets/data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            widget_key: widget.widget_key,
            config: widget.config,
          }),
        });
        const json = await res.json();
        setData(json.data);
      } catch (error) {
        console.error('Error fetching receiving today:', error);
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
