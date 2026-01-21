'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';

interface ABCItem {
  catalog_item_id: string;
  sku: string;
  item_name: string;
  classification: string;
  annual_usage_qty: number;
  annual_usage_value: number;
  cumulative_value_pct: number;
  value_rank: number;
  management_strategy: string;
  review_frequency: string;
}

export default function ABCClassificationPage() {
  const [items, setItems] = useState<ABCItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [selectedClass, setSelectedClass] = useState<string>('');

  useEffect(() => {
    fetchClassification();
  }, []);

  const fetchClassification = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/inventory/abc-classification');
      const { data } = await res.json();
      setItems(data || []);
    } catch (error) {
      console.error('Error fetching ABC classification:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCalculate = async () => {
    if (!confirm('Recalculate ABC classification based on last 365 days of usage? This may take a few moments.')) {
      return;
    }

    setCalculating(true);
    try {
      const res = await fetch('/api/inventory/abc-classification/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'value', // value, usage, or hybrid
        })
      });

      const result = await res.json();

      if (res.ok) {
        alert(`Classification complete!\nClass A: ${result.class_a}\nClass B: ${result.class_b}\nClass C: ${result.class_c}`);
        fetchClassification();
      } else {
        alert(`Error: ${result.error || 'Failed to calculate classification'}`);
      }
    } catch (error) {
      console.error('Error calculating classification:', error);
      alert('Failed to calculate classification. Please try again.');
    } finally {
      setCalculating(false);
    }
  };

  const getClassColor = (classification: string) => {
    switch (classification) {
      case 'A': return 'bg-red-600';
      case 'B': return 'bg-yellow-500';
      case 'C': return 'bg-green-600';
      case 'D': return 'bg-gray-500';
      default: return 'bg-gray-400';
    }
  };

  const getClassLabel = (classification: string) => {
    switch (classification) {
      case 'A': return 'High Value (80%)';
      case 'B': return 'Medium Value (15%)';
      case 'C': return 'Low Value (5%)';
      case 'D': return 'Obsolete';
      default: return classification;
    }
  };

  const filteredItems = selectedClass
    ? items.filter(item => item.classification === selectedClass)
    : items;

  const columns = [
    {
      key: 'classification',
      header: 'Class',
      sortable: true,
      render: (row: ABCItem) => (
        <div className="flex items-center gap-2">
          <span className={`px-3 py-1 text-xs font-bold text-white rounded ${getClassColor(row.classification)}`}>
            {row.classification}
          </span>
          <span className="text-xs text-muted-foreground">#{row.value_rank}</span>
        </div>
      ),
    },
    {
      key: 'item',
      header: 'Item',
      sortable: true,
      render: (row: ABCItem) => (
        <div>
          <div className="font-medium">{row.item_name}</div>
          <div className="text-xs text-muted-foreground font-mono">{row.sku}</div>
        </div>
      ),
    },
    {
      key: 'annual_usage_qty',
      header: 'Annual Usage',
      sortable: true,
      className: 'text-right font-mono',
      render: (row: ABCItem) => row.annual_usage_qty?.toLocaleString() || '0',
    },
    {
      key: 'annual_usage_value',
      header: 'Annual Value',
      sortable: true,
      className: 'text-right font-mono',
      render: (row: ABCItem) => (
        <span className="font-semibold">
          ${row.annual_usage_value?.toLocaleString(undefined, { minimumFractionDigits: 2 }) || '0.00'}
        </span>
      ),
    },
    {
      key: 'cumulative_value_pct',
      header: 'Cumulative %',
      sortable: true,
      className: 'text-right',
      render: (row: ABCItem) => (
        <span className="text-sm">
          {((row.cumulative_value_pct || 0) * 100).toFixed(1)}%
        </span>
      ),
    },
    {
      key: 'review_frequency',
      header: 'Review Cycle',
      render: (row: ABCItem) => (
        <span className="text-sm">{row.review_frequency}</span>
      ),
    },
    {
      key: 'management_strategy',
      header: 'Strategy',
      render: (row: ABCItem) => (
        <div className="text-xs text-muted-foreground max-w-xs">
          {row.management_strategy}
        </div>
      ),
    },
  ];

  const classACount = items.filter(i => i.classification === 'A').length;
  const classBCount = items.filter(i => i.classification === 'B').length;
  const classCCount = items.filter(i => i.classification === 'C').length;
  const totalValue = items.reduce((sum, i) => sum + (i.annual_usage_value || 0), 0);

  return (
    <AppShell>
      <div className="p-6">
        <PageHeader
          title="ABC Classification"
          description="Inventory stratification by value and usage patterns"
          actions={
            <button
              onClick={handleCalculate}
              disabled={calculating}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
            >
              {calculating ? 'Calculating...' : 'Recalculate'}
            </button>
          }
        />

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
          <div
            className="bg-white p-4 rounded-lg border-2 border-red-200 cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => setSelectedClass(selectedClass === 'A' ? '' : 'A')}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-muted-foreground">Class A Items</div>
                <div className="text-2xl font-bold mt-1">{classACount}</div>
                <div className="text-xs text-muted-foreground mt-1">High Value • Weekly Review</div>
              </div>
              <div className="w-12 h-12 bg-red-600 rounded-full flex items-center justify-center text-white font-bold text-xl">
                A
              </div>
            </div>
          </div>

          <div
            className="bg-white p-4 rounded-lg border-2 border-yellow-200 cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => setSelectedClass(selectedClass === 'B' ? '' : 'B')}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-muted-foreground">Class B Items</div>
                <div className="text-2xl font-bold mt-1">{classBCount}</div>
                <div className="text-xs text-muted-foreground mt-1">Medium Value • Monthly Review</div>
              </div>
              <div className="w-12 h-12 bg-yellow-500 rounded-full flex items-center justify-center text-white font-bold text-xl">
                B
              </div>
            </div>
          </div>

          <div
            className="bg-white p-4 rounded-lg border-2 border-green-200 cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => setSelectedClass(selectedClass === 'C' ? '' : 'C')}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-muted-foreground">Class C Items</div>
                <div className="text-2xl font-bold mt-1">{classCCount}</div>
                <div className="text-xs text-muted-foreground mt-1">Low Value • Quarterly Review</div>
              </div>
              <div className="w-12 h-12 bg-green-600 rounded-full flex items-center justify-center text-white font-bold text-xl">
                C
              </div>
            </div>
          </div>

          <div className="bg-white p-4 rounded-lg border">
            <div className="text-sm text-muted-foreground">Total Annual Value</div>
            <div className="text-2xl font-bold mt-1">
              ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 0 })}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Last 365 days</div>
          </div>
        </div>

        {/* Info Banner */}
        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <div className="text-blue-600 text-lg">ℹ️</div>
            <div className="text-sm">
              <div className="font-semibold text-blue-900 mb-1">ABC Classification Methodology</div>
              <div className="text-blue-800">
                <strong>Class A (High Value):</strong> Top 80% of annual inventory value. Requires tight controls, accurate forecasting, and frequent reviews.
                <br />
                <strong>Class B (Medium Value):</strong> Next 15% of value. Standard controls with regular monitoring.
                <br />
                <strong>Class C (Low Value):</strong> Remaining 5% of value. Simple controls, bulk ordering acceptable.
              </div>
            </div>
          </div>
        </div>

        {/* Filter indicator */}
        {selectedClass && (
          <div className="mt-4 flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Filtered to:</span>
            <span className={`px-3 py-1 text-xs font-bold text-white rounded ${getClassColor(selectedClass)}`}>
              Class {selectedClass}
            </span>
            <button
              onClick={() => setSelectedClass('')}
              className="text-xs text-blue-600 hover:underline"
            >
              Clear filter
            </button>
          </div>
        )}

        {/* Classification Table */}
        <div className="mt-4">
          <DataTable
            columns={columns}
            data={filteredItems}
            loading={loading}
            rowKey={(row) => row.catalog_item_id}
          />
        </div>
      </div>
    </AppShell>
  );
}
