'use client';

import { useState, useEffect } from 'react';
import type { WidgetProps } from '@/types/dashboard';

export function BaseMetricWidget({ widget, data, isLoading }: WidgetProps) {
  const [value, setValue] = useState<string | number>('--');
  const [change, setChange] = useState<string | null>(null);
  const [trend, setTrend] = useState<'up' | 'down' | 'neutral'>('neutral');

  useEffect(() => {
    if (data && !isLoading) {
      setValue(data.value ?? '--');
      setChange(data.change ?? null);
      setTrend(data.trend ?? 'neutral');
    }
  }, [data, isLoading]);

  const trendColor = {
    up: 'text-green-600',
    down: 'text-red-600',
    neutral: 'text-gray-600',
  }[trend];

  const trendIcon = {
    up: '↑',
    down: '↓',
    neutral: '→',
  }[trend];

  return (
    <div className="h-full flex flex-col justify-between p-6 bg-white rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
      <div className="text-sm font-semibold text-gray-600 uppercase tracking-wide">{widget.title}</div>
      
      <div className="mt-4">
        {isLoading ? (
          <div className="animate-pulse">
            <div className="h-10 bg-gray-200 rounded w-24"></div>
          </div>
        ) : (
          <div className="text-4xl font-bold bg-gradient-to-br from-gray-900 to-gray-700 bg-clip-text text-transparent">
            {typeof value === 'number' ? value.toLocaleString() : value}
          </div>
        )}
        
        {change && (
          <div className={`mt-2 text-sm flex items-center gap-1 ${trendColor}`}>
            <span>{trendIcon}</span>
            <span>{change}</span>
          </div>
        )}
      </div>

      {widget.config?.description && (
        <div className="mt-4 text-xs text-gray-500">
          {widget.config.description}
        </div>
      )}
    </div>
  );
}
