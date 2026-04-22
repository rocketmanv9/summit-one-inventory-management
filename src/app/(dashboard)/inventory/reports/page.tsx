'use client';

import { useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';

const reports = [
  {
    id: 'stock-valuation',
    name: 'Stock Valuation Report',
    description: 'Total inventory value by location and category with current costs',
    icon: '💰',
  },
  {
    id: 'movement-summary',
    name: 'Movement Summary',
    description: 'Stock movements aggregated by type (receive, issue, transfer, adjust)',
    icon: '📊',
  },
  {
    id: 'reorder-suggestions',
    name: 'Reorder Suggestions',
    description: 'Items below reorder point with suggested order quantities',
    icon: '🔔',
  },
  {
    id: 'dead-stock',
    name: 'Dead Stock Report',
    description: 'Items with no movement in 90+ days, sorted by capital locked',
    icon: '📦',
  },
  {
    id: 'velocity-analysis',
    name: 'Velocity Analysis',
    description: 'Item consumption rates (30/60/90 day) with days-of-stock projections',
    icon: '⚡',
  },
  {
    id: 'forecast-report',
    name: 'Forecast Report',
    description: 'Current stock + incoming POs - future demand = net position per item',
    icon: '🔮',
  },
];

function formatCellValue(value: unknown, key: string): string {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'number') {
    // Currency-like columns
    if (key.includes('cost') || key.includes('value') || key.includes('capital')) {
      return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    // Quantity columns with decimals
    if (Number.isInteger(value)) return value.toLocaleString();
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  // Timestamp columns
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return new Date(value).toLocaleDateString();
  }
  return String(value);
}

export default function ReportsPage() {
  const [loading, setLoading] = useState<string | null>(null);
  const [reportData, setReportData] = useState<any[] | null>(null);
  const [activeReport, setActiveReport] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generateReport = async (reportId: string) => {
    setLoading(reportId);
    setActiveReport(reportId);
    setError(null);
    setReportData(null);

    try {
      const res = await fetch(`/api/inventory/reports/${reportId}`);
      const json = await res.json();

      if (!res.ok) {
        setError(json.error || 'Failed to generate report');
        return;
      }

      setReportData(json.data);
    } catch (err) {
      console.error('Error generating report:', err);
      setError('Network error - failed to generate report');
    } finally {
      setLoading(null);
    }
  };

  const closeReport = () => {
    setReportData(null);
    setActiveReport(null);
    setError(null);
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Reports"
          description="Generate inventory reports showing stock valuations, movement patterns, and reorder recommendations based on your current inventory data."
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {reports.map((report) => (
            <div
              key={report.id}
              className="p-6 rounded-lg border bg-card hover:shadow-md transition-shadow"
            >
              <div className="text-3xl mb-3">{report.icon}</div>
              <h3 className="font-semibold text-lg">{report.name}</h3>
              <p className="text-sm text-muted-foreground mt-1 mb-4">
                {report.description}
              </p>
              <button
                onClick={() => generateReport(report.id)}
                disabled={loading !== null}
                className="w-full px-3 py-2 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
              >
                {loading === report.id ? 'Generating...' : 'Generate Report'}
              </button>
            </div>
          ))}
        </div>

        {/* Error display */}
        {error && activeReport && (
          <div className="p-4 rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/20 dark:border-red-800">
            <div className="flex justify-between items-center">
              <p className="text-sm text-red-700 dark:text-red-400">
                {error}
              </p>
              <button
                onClick={closeReport}
                className="text-sm text-red-500 hover:text-red-700"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Report Results */}
        {reportData && activeReport && (
          <div className="p-6 rounded-lg border bg-card">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="font-semibold text-lg">
                  {reports.find((r) => r.id === activeReport)?.name}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {reportData.length} {reportData.length === 1 ? 'row' : 'rows'}
                </p>
              </div>
              <button
                onClick={closeReport}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Close
              </button>
            </div>

            {reportData.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      {Object.keys(reportData[0]).map((key) => (
                        <th key={key} className="p-2 text-left font-medium whitespace-nowrap">
                          {key
                            .replace(/_/g, ' ')
                            .replace(/\b\w/g, (l: string) => l.toUpperCase())}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {reportData.map((row: any, idx: number) => (
                      <tr key={idx} className="hover:bg-muted/50">
                        {Object.entries(row).map(([key, value], cellIdx) => (
                          <td key={cellIdx} className="p-2 whitespace-nowrap">
                            {formatCellValue(value, key)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center p-8 text-muted-foreground">
                No data available for this report
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
