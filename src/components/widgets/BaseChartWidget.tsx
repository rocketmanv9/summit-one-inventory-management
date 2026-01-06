'use client';

import { useState, useEffect } from 'react';
import type { WidgetProps } from '@/types/dashboard';

interface ChartData {
  labels: string[];
  datasets: {
    label: string;
    data: number[];
    color?: string;
  }[];
}

export function BaseChartWidget({ widget, data, isLoading }: WidgetProps) {
  const [chartData, setChartData] = useState<ChartData | null>(null);

  useEffect(() => {
    if (data && !isLoading) {
      setChartData(data as ChartData);
    }
  }, [data, isLoading]);

  // Simple bar chart visualization (can be replaced with chart library later)
  const renderSimpleBarChart = () => {
    if (!chartData || chartData.datasets.length === 0) return null;

    const dataset = chartData.datasets[0];
    const maxValue = Math.max(...dataset.data);

    return (
      <div className="space-y-3">
        {chartData.labels.map((label, idx) => {
          const value = dataset.data[idx];
          const percentage = maxValue > 0 ? (value / maxValue) * 100 : 0;

          return (
            <div key={idx}>
              <div className="flex justify-between text-xs text-gray-600 mb-1">
                <span>{label}</span>
                <span className="font-medium">{value.toLocaleString()}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all"
                  style={{ width: `${percentage}%` }}
                ></div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-white rounded-lg border border-gray-200 p-6">
      <div className="mb-4">
        <h3 className="text-sm font-medium text-gray-900">{widget.title}</h3>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="animate-pulse space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-4 bg-gray-200 rounded"></div>
            ))}
          </div>
        ) : !chartData ? (
          <div className="text-center text-gray-500">No chart data available</div>
        ) : (
          renderSimpleBarChart()
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
