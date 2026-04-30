'use client';

import type { AiChartDisplay } from '@/lib/ai/types';

interface AiBarChartProps {
  data: AiChartDisplay;
}

const DEFAULT_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6'];

export function AiBarChart({ data }: AiBarChartProps) {
  // Find max value across all datasets for scaling
  const allValues = data.datasets.flatMap((ds) => ds.data);
  const maxValue = Math.max(...allValues, 1);

  return (
    <div className="mt-2 rounded-lg border border-gray-200 bg-white p-4">
      {/* Legend */}
      {data.datasets.length > 1 && (
        <div className="flex flex-wrap gap-3 mb-3">
          {data.datasets.map((ds, i) => (
            <div key={ds.label} className="flex items-center gap-1.5">
              <div
                className="w-3 h-3 rounded-sm"
                style={{ backgroundColor: ds.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length] }}
              />
              <span className="text-xs text-gray-600">{ds.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Bars */}
      <div className="space-y-2">
        {data.labels.map((label, labelIdx) => (
          <div key={label} className="space-y-1">
            <div className="text-xs font-medium text-gray-700 truncate">{label}</div>
            {data.datasets.map((ds, dsIdx) => {
              const value = ds.data[labelIdx] || 0;
              const pct = (value / maxValue) * 100;
              const color = ds.color || DEFAULT_COLORS[dsIdx % DEFAULT_COLORS.length];

              return (
                <div key={ds.label} className="flex items-center gap-2">
                  <div className="flex-1 h-5 bg-gray-100 rounded-sm overflow-hidden">
                    <div
                      className="h-full rounded-sm transition-all duration-300"
                      style={{
                        width: `${Math.max(pct, 1)}%`,
                        backgroundColor: color,
                      }}
                    />
                  </div>
                  <span className="text-xs text-gray-600 w-16 text-right tabular-nums">
                    {new Intl.NumberFormat('en-US').format(value)}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
