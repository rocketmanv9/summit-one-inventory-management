'use client';

import { useState } from 'react';
import type { AiTableDisplay } from '@/lib/ai/types';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface AiDataTableProps {
  data: AiTableDisplay;
}

const INITIAL_ROWS = 10;

export function AiDataTable({ data }: AiDataTableProps) {
  const [expanded, setExpanded] = useState(false);
  const visibleRows = expanded ? data.rows : data.rows.slice(0, INITIAL_ROWS);
  const hasMore = data.rows.length > INITIAL_ROWS;

  return (
    <div className="mt-2 rounded-lg border border-gray-200 bg-white overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              {data.columns.map((col) => (
                <th
                  key={col.key}
                  className="px-3 py-2 text-left font-semibold text-gray-600 whitespace-nowrap"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, i) => (
              <tr
                key={i}
                className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}
              >
                {data.columns.map((col) => (
                  <td key={col.key} className="px-3 py-1.5 text-gray-700 whitespace-nowrap">
                    {formatCellValue(row[col.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center justify-center gap-1 px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-50 transition-colors border-t border-gray-200"
        >
          {expanded ? (
            <>
              <ChevronUp className="w-3 h-3" />
              Show fewer rows
            </>
          ) : (
            <>
              <ChevronDown className="w-3 h-3" />
              Show all {data.totalRows ?? data.rows.length} rows
            </>
          )}
        </button>
      )}
    </div>
  );
}

function formatCellValue(value: any): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'number') {
    // Format currency-like values
    if (Math.abs(value) >= 100) {
      return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
    }
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
  }
  return String(value);
}
