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
    available: true,
  },
  {
    id: 'movement-summary',
    name: 'Movement Summary',
    description: 'Stock movements aggregated by type (receive, issue, transfer, adjust)',
    icon: '📊',
    available: true,
  },
  {
    id: 'reorder-suggestions',
    name: 'Reorder Suggestions',
    description: 'Items below reorder point with suggested order quantities',
    icon: '🔔',
    available: true,
  },
];

export default function ReportsPage() {
  const [loading, setLoading] = useState<string | null>(null);
  const [reportData, setReportData] = useState<any>(null);
  const [activeReport, setActiveReport] = useState<string | null>(null);

  const generateReport = async (reportId: string) => {
    setLoading(reportId);
    setActiveReport(reportId);
    
    try {
      const res = await fetch(`/api/inventory/reports/${reportId}`);
      const data = await res.json();
      setReportData(data);
    } catch (error) {
      console.error('Error generating report:', error);
      alert('Failed to generate report');
    } finally {
      setLoading(null);
    }
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
              <h3 className="font-semibold text-lg">
                {report.name}
              </h3>
              <p className="text-sm text-muted-foreground mt-1 mb-4">
                {report.description}
              </p>
              <button 
                onClick={() => generateReport(report.id)}
                disabled={loading === report.id}
                className="w-full px-3 py-2 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
              >
                {loading === report.id ? 'Generating...' : 'Generate Report'}
              </button>
            </div>
          ))}
        </div>

        {/* Report Results */}
        {reportData && activeReport && (
          <div className="p-6 rounded-lg border bg-card">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-semibold text-lg">
                {reports.find(r => r.id === activeReport)?.name}
              </h3>
              <button
                onClick={() => {
                  setReportData(null);
                  setActiveReport(null);
                }}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Close
              </button>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    {reportData.data && reportData.data.length > 0 && 
                      Object.keys(reportData.data[0]).map((key) => (
                        <th key={key} className="p-2 text-left font-medium">
                          {key.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}
                        </th>
                      ))
                    }
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {reportData.data && reportData.data.map((row: any, idx: number) => (
                    <tr key={idx} className="hover:bg-muted/50">
                      {Object.values(row).map((value: any, cellIdx) => (
                        <td key={cellIdx} className="p-2">
                          {typeof value === 'number' ? value.toLocaleString() : value}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {reportData.data && reportData.data.length === 0 && (
                <div className="text-center p-8 text-muted-foreground">
                  No data available for this report
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
