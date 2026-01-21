'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/FilterBar';
import { StatusChip } from '@/components/ui/StatusChip';

interface CycleCount {
  id: string;
  location_id: string;
  count_type: string;
  status: string;
  created_at: string;
  completed_at?: string;
  approved_by?: string;
  approved_at?: string;
  locations?: { id: string; name: string; location_type: string };
  cycle_count_lines?: Array<{
    id: string;
    catalog_item_id: string;
    expected_qty: number;
    counted_qty?: number;
    variance_qty?: number;
    variance_approved?: boolean;
    catalog_items?: { id: string; name: string; sku: string };
  }>;
}

export default function CycleCountsPage() {
  const [cycleCounts, setCycleCounts] = useState<CycleCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedCount, setSelectedCount] = useState<CycleCount | null>(null);

  useEffect(() => {
    fetchCycleCounts();
  }, [filters]);

  const fetchCycleCounts = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.status) params.set('status', filters.status);

      const res = await fetch(`/api/inventory/cycle-counts?${params}`);
      const { data } = await res.json();
      setCycleCounts(data || []);
    } catch (error) {
      console.error('Error fetching cycle counts:', error);
    } finally {
      setLoading(false);
    }
  };

  const calculateVariance = (cc: CycleCount) => {
    if (!cc.cycle_count_lines) return { total: 0, percent: 0 };
    const totalExpected = cc.cycle_count_lines.reduce((sum, l) => sum + l.expected_qty, 0);
    const totalVariance = cc.cycle_count_lines.reduce((sum, l) => sum + Math.abs(l.variance_qty || 0), 0);
    return {
      total: totalVariance,
      percent: totalExpected > 0 ? Math.round((totalVariance / totalExpected) * 100) : 0,
    };
  };

  const columns = [
    {
      key: 'id',
      header: 'Count #',
      render: (row: CycleCount) => (
        <span className="font-mono text-sm">{row.id.slice(0, 8).toUpperCase()}</span>
      ),
    },
    {
      key: 'location',
      header: 'Location',
      sortable: true,
      render: (row: CycleCount) => (
        <div>
          <div className="font-medium">{row.locations?.name || '-'}</div>
          <div className="text-xs text-muted-foreground capitalize">
            {row.locations?.location_type?.replace('_', ' ') || ''}
          </div>
        </div>
      ),
    },
    {
      key: 'count_type',
      header: 'Type',
      render: (row: CycleCount) => (
        <StatusChip status={row.count_type} />
      ),
    },
    {
      key: 'lines',
      header: 'Items',
      render: (row: CycleCount) => (
        <div>
          <div>{row.cycle_count_lines?.length || 0} item(s)</div>
          <div className="text-xs text-muted-foreground">
            {row.cycle_count_lines?.filter(l => l.counted_qty !== null && l.counted_qty !== undefined).length || 0} counted
          </div>
        </div>
      ),
    },
    {
      key: 'variance',
      header: 'Variance',
      render: (row: CycleCount) => {
        const variance = calculateVariance(row);
        if (row.status === 'scheduled' || row.status === 'in_progress') return '-';
        return (
          <div className={variance.percent > 5 ? 'text-red-600' : variance.percent > 0 ? 'text-yellow-600' : 'text-green-600'}>
            <div className="font-medium">{variance.total} units</div>
            <div className="text-xs">{variance.percent}%</div>
          </div>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: CycleCount) => (
        <StatusChip status={row.status} />
      ),
    },
    {
      key: 'created_at',
      header: 'Created',
      sortable: true,
      render: (row: CycleCount) => new Date(row.created_at).toLocaleDateString(),
    },
    {
      key: 'actions',
      header: '',
      render: (row: CycleCount) => (
        <div className="flex gap-2">
          {row.status === 'in_progress' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSelectedCount(row);
              }}
              className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded hover:bg-blue-200"
            >
              Enter Counts
            </button>
          )}
          {row.status === 'completed' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSelectedCount(row);
              }}
              className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded hover:bg-green-200"
            >
              Review
            </button>
          )}
        </div>
      ),
    },
  ];

  const filterConfig = [
    {
      key: 'status',
      label: 'Status',
      type: 'select' as const,
      options: [
        { value: 'scheduled', label: 'Scheduled' },
        { value: 'in_progress', label: 'In Progress' },
        { value: 'completed', label: 'Completed' },
        { value: 'cancelled', label: 'Cancelled' },
      ],
    },
  ];

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Cycle Counts"
          description="Manage inventory cycle counts and variance reviews. Example: Physically count all asphalt mix at the plant yard, compare to system records, and approve adjustments for 5 tons that was used for equipment maintenance (variance)."
          actions={
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              + Start Cycle Count
            </button>
          }
        />

        <div className="grid grid-cols-4 gap-4">
          <div className="p-4 bg-cyan-50 border border-cyan-200 rounded-lg">
            <div className="text-2xl font-bold text-cyan-700">
              {cycleCounts.filter(c => c.status === 'scheduled').length}
            </div>
            <div className="text-sm text-cyan-600">Scheduled</div>
          </div>
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="text-2xl font-bold text-blue-700">
              {cycleCounts.filter(c => c.status === 'in_progress').length}
            </div>
            <div className="text-sm text-blue-600">In Progress</div>
          </div>
          <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="text-2xl font-bold text-yellow-700">
              {cycleCounts.filter(c => c.status === 'completed' && !c.approved_at).length}
            </div>
            <div className="text-sm text-yellow-600">Pending Approval</div>
          </div>
          <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="text-2xl font-bold text-green-700">
              {cycleCounts.filter(c => c.approved_at).length}
            </div>
            <div className="text-sm text-green-600">Approved</div>
          </div>
        </div>

        <FilterBar
          filters={filterConfig}
          values={filters}
          onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
          onClear={() => setFilters({})}
        />

        <DataTable
          data={cycleCounts}
          columns={columns}
          loading={loading}
          emptyMessage="No cycle counts found"
          rowKey={(row) => row.id}
          onRowClick={setSelectedCount}
        />

        {selectedCount && (
          <CycleCountDetailPanel
            cycleCount={selectedCount}
            onClose={() => setSelectedCount(null)}
            onUpdate={fetchCycleCounts}
          />
        )}

        {showCreateModal && (
          <CreateCycleCountModal
            onClose={() => setShowCreateModal(false)}
            onCreated={() => {
              setShowCreateModal(false);
              fetchCycleCounts();
            }}
          />
        )}
      </div>
    </AppShell>
  );
}

function CycleCountDetailPanel({ cycleCount, onClose, onUpdate }: {
  cycleCount: CycleCount;
  onClose: () => void;
  onUpdate: () => void;
}) {
  const [lines, setLines] = useState(cycleCount.cycle_count_lines || []);
  const [saving, setSaving] = useState(false);

  const updateCount = (lineId: string, countedQty: string) => {
    setLines(lines.map(l => {
      if (l.id === lineId) {
        const counted = parseInt(countedQty) || 0;
        return {
          ...l,
          counted_qty: counted,
          variance_qty: counted - l.expected_qty,
        };
      }
      return l;
    }));
  };

  const handleSaveCounts = async () => {
    setSaving(true);
    try {
      for (const line of lines) {
        if (line.counted_qty !== null && line.counted_qty !== undefined) {
          await fetch(`/api/inventory/cycle-counts/${cycleCount.id}/record`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              catalog_item_id: line.catalog_item_id,
              counted_qty: line.counted_qty,
            }),
          });
        }
      }
      onUpdate();
    } catch (error) {
      console.error('Error saving counts:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async () => {
    if (!confirm('Approve this cycle count and apply adjustments?')) return;

    try {
      await fetch(`/api/inventory/cycle-counts/${cycleCount.id}/approve`, {
        method: 'POST',
      });
      onUpdate();
      onClose();
    } catch (error) {
      console.error('Error approving cycle count:', error);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 w-[32rem] bg-white shadow-xl border-l z-40 overflow-y-auto">
      <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-white">
        <h3 className="font-semibold">Cycle Count Details</h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
      </div>

      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <span className="font-mono">{cycleCount.id.slice(0, 8).toUpperCase()}</span>
          <StatusChip status={cycleCount.status} />
        </div>

        <div className="p-3 bg-muted/30 rounded-lg">
          <div className="text-xs text-muted-foreground">Location</div>
          <div className="font-medium">{cycleCount.locations?.name}</div>
        </div>

        <div className="border-t pt-4">
          <h4 className="font-medium mb-3">Count Lines</h4>
          <div className="space-y-2">
            {lines.map((line) => (
              <div key={line.id} className="p-3 bg-muted/30 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-medium">{line.catalog_items?.name || 'Unknown'}</div>
                  <div className="text-xs text-muted-foreground">{line.catalog_items?.sku}</div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <div className="text-xs text-muted-foreground">Expected</div>
                    <div className="font-mono">{line.expected_qty}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Counted</div>
                    {cycleCount.status === 'in_progress' ? (
                      <input
                        type="number"
                        value={line.counted_qty ?? ''}
                        onChange={(e) => updateCount(line.id, e.target.value)}
                        className="w-full px-2 py-1 border rounded font-mono text-sm"
                        min="0"
                      />
                    ) : (
                      <div className="font-mono">{line.counted_qty ?? '-'}</div>
                    )}
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Variance</div>
                    <div className={`font-mono ${
                      (line.variance_qty || 0) > 0 ? 'text-green-600' :
                      (line.variance_qty || 0) < 0 ? 'text-red-600' : ''
                    }`}>
                      {line.variance_qty !== null && line.variance_qty !== undefined
                        ? (line.variance_qty > 0 ? '+' : '') + line.variance_qty
                        : '-'}
                    </div>
                  </div>
                </div>
                {line.variance_approved !== undefined && (
                  <div className="mt-2">
                    <StatusChip
                      status={line.variance_approved ? 'approved' : 'pending'}
                      size="sm"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="border-t pt-4 flex gap-2">
          {cycleCount.status === 'in_progress' && (
            <button
              onClick={handleSaveCounts}
              disabled={saving}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Counts'}
            </button>
          )}
          {cycleCount.status === 'completed' && !cycleCount.approved_at && (
            <button
              onClick={handleApprove}
              className="flex-1 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
            >
              Approve & Apply
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function CreateCycleCountModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    location_id: '',
    count_type: 'full',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      const res = await fetch('/api/inventory/cycle-counts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to start cycle count');
      }

      onCreated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold">Start Cycle Count</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">Location *</label>
            <input
              type="text"
              value={form.location_id}
              onChange={(e) => setForm({ ...form, location_id: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono"
              placeholder="Location UUID"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Count Type</label>
            <select
              value={form.count_type}
              onChange={(e) => setForm({ ...form, count_type: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="full">Full Count</option>
              <option value="spot">Spot Check</option>
              <option value="abc">ABC Analysis</option>
            </select>
          </div>

          <div className="flex gap-3 pt-4">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? 'Starting...' : 'Start Count'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
