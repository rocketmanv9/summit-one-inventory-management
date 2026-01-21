'use client';

import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';

const reports = [
  {
    id: 'stock-valuation',
    name: 'Stock Valuation Report',
    description: 'Total inventory value by location and category',
    icon: '💰',
  },
  {
    id: 'movement-summary',
    name: 'Movement Summary',
    description: 'Stock movements aggregated by type and period',
    icon: '📊',
  },
  {
    id: 'reorder-suggestions',
    name: 'Reorder Suggestions',
    description: 'Items below reorder point with suggested quantities',
    icon: '🔔',
  },
  {
    id: 'vendor-performance',
    name: 'Vendor Performance',
    description: 'Lead time and fill rate by vendor',
    icon: '🏢',
  },
  {
    id: 'cycle-count-accuracy',
    name: 'Cycle Count Accuracy',
    description: 'Variance trends and accuracy metrics',
    icon: '✅',
  },
  {
    id: 'aging-inventory',
    name: 'Aging Inventory',
    description: 'Stock age analysis and slow-moving items',
    icon: '⏳',
  },
];

export default function ReportsPage() {
  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Reports"
          description="Generate inventory reports and analytics. Example: Run reports showing asphalt usage by job, low stock alerts for concrete, cost analysis per project, or monthly consumption trends for diesel fuel across all equipment."
        />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {reports.map((report) => (
            <div
              key={report.id}
              className="p-6 rounded-lg border bg-card hover:shadow-md transition-shadow cursor-pointer group"
            >
              <div className="text-3xl mb-3">{report.icon}</div>
              <h3 className="font-semibold text-lg group-hover:text-primary transition-colors">
                {report.name}
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                {report.description}
              </p>
              <div className="mt-4 flex gap-2">
                <button className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90">
                  Generate
                </button>
                <button className="px-3 py-1.5 text-sm border rounded hover:bg-muted">
                  Schedule
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="p-6 rounded-lg border bg-muted/30">
          <h3 className="font-semibold mb-2">Custom Reports</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Build custom reports using the query builder or SQL.
          </p>
          <button className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700">
            Open Query Builder
          </button>
        </div>
      </div>
    </AppShell>
  );
}
