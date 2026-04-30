'use client';

import type { AiMetricDisplay } from '@/lib/ai/types';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface AiMetricCardProps {
  data: AiMetricDisplay;
}

export function AiMetricCard({ data }: AiMetricCardProps) {
  const trendIcon =
    data.trend === 'up' ? (
      <TrendingUp className="w-4 h-4 text-green-500" />
    ) : data.trend === 'down' ? (
      <TrendingDown className="w-4 h-4 text-red-500" />
    ) : data.trend === 'neutral' ? (
      <Minus className="w-4 h-4 text-gray-400" />
    ) : null;

  return (
    <div className="mt-2 rounded-lg border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-4">
      <div className="text-xs font-medium text-blue-600 uppercase tracking-wide">
        {data.label}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-bold text-gray-900">{data.value}</span>
        {data.unit && (
          <span className="text-sm text-gray-500">{data.unit}</span>
        )}
        {trendIcon}
        {data.change && (
          <span
            className={`text-xs font-medium ${
              data.trend === 'up'
                ? 'text-green-600'
                : data.trend === 'down'
                  ? 'text-red-600'
                  : 'text-gray-500'
            }`}
          >
            {data.change}
          </span>
        )}
      </div>

      {data.secondaryMetrics && data.secondaryMetrics.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {data.secondaryMetrics.map((m) => (
            <div key={m.label} className="flex items-center justify-between rounded bg-white/60 px-2 py-1">
              <span className="text-xs text-gray-500">{m.label}</span>
              <span className="text-xs font-semibold text-gray-700">{m.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
