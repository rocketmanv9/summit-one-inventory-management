'use client';

import { useState, useEffect } from 'react';
import type { WidgetProps } from '@/types/dashboard';

interface TableData {
  columns: { key: string; label: string }[];
  rows: Record<string, any>[];
}

export function BaseTableWidget({ widget, data, isLoading }: WidgetProps) {
  const [tableData, setTableData] = useState<TableData>({ columns: [], rows: [] });

  useEffect(() => {
    if (data && !isLoading) {
      setTableData({
        columns: data.columns || [],
        rows: data.rows || [],
      });
    }
  }, [data, isLoading]);

  return (
    <div className="h-full flex flex-col bg-white rounded-lg border border-gray-200">
      <div className="px-6 py-4 border-b border-gray-200">
        <h3 className="text-sm font-medium text-gray-900">{widget.title}</h3>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-6">
            <div className="animate-pulse space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-4 bg-gray-200 rounded"></div>
              ))}
            </div>
          </div>
        ) : tableData.rows.length === 0 ? (
          <div className="p-6 text-center text-gray-500">
            No data available
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {tableData.columns.map((col) => (
                  <th
                    key={col.key}
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {tableData.rows.map((row, idx) => (
                <tr key={idx} className="hover:bg-gray-50">
                  {tableData.columns.map((col) => (
                    <td
                      key={col.key}
                      className="px-6 py-4 whitespace-nowrap text-sm text-gray-900"
                    >
                      {row[col.key] ?? '--'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
