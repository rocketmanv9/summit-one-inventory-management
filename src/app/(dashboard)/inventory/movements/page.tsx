'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/FilterBar';
import { StatusChip } from '@/components/ui/StatusChip';
import { apiWrite } from '@/lib/api-client';

interface StockMovement {
  id: string;
  catalog_item_id: string;
  location_id: string;
  quantity_delta: number;
  movement_type: string;
  movement_state: string;
  reason_code?: string;
  source_document_type?: string;
  source_document_id?: string;
  reversal_ref_id?: string;
  created_at: string;
  created_by?: string;
  catalog_items?: { id: string; sku: string; name: string };
  locations?: { id: string; code: string; name: string };
}

export default function StockMovementsPage() {
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [selectedMovement, setSelectedMovement] = useState<StockMovement | null>(null);

  useEffect(() => {
    fetchMovements();
  }, [filters]);

  const fetchMovements = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.catalog_item_id) params.set('catalog_item_id', filters.catalog_item_id);
      if (filters.location_id) params.set('location_id', filters.location_id);
      if (filters.movement_type) params.set('movement_type', filters.movement_type);
      if (filters.movement_state) params.set('movement_state', filters.movement_state);

      const res = await fetch(`/api/inventory/movements?${params}`);
      const { data } = await res.json();
      setMovements(data || []);
    } catch (error) {
      console.error('Error fetching movements:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleReverse = async (movementId: string) => {
    const reason = prompt('Enter reversal reason:');
    if (!reason) return;

    if (!confirm('Are you sure you want to reverse this stock movement? This will create an offsetting entry.')) {
      return;
    }

    try {
      const res = await apiWrite(`/api/inventory/movements/${movementId}/reverse`, {
        method: 'POST',
        body: { reason_code: reason }
      });

      if (!res.ok) {
        const result = await res.json();
        alert(`Error: ${result.error?.message || result.error || 'Failed to reverse movement'}`);
        return;
      }

      alert('Stock movement reversed successfully!');
      fetchMovements();
    } catch (error) {
      console.error('Error reversing movement:', error);
      alert('Failed to reverse movement. Please try again.');
    }
  };

  const columns = [
    {
      key: 'created_at',
      header: 'Date/Time',
      sortable: true,
      render: (row: StockMovement) => (
        <div className="text-sm">
          <div>{new Date(row.created_at).toLocaleDateString()}</div>
          <div className="text-xs text-muted-foreground">
            {new Date(row.created_at).toLocaleTimeString()}
          </div>
        </div>
      ),
    },
    {
      key: 'item',
      header: 'Item',
      sortable: true,
      render: (row: StockMovement) => (
        <div>
          <div className="font-medium">{row.catalog_items?.name || '-'}</div>
          <div className="text-xs text-muted-foreground font-mono">{row.catalog_items?.sku}</div>
        </div>
      ),
    },
    {
      key: 'location',
      header: 'Location',
      sortable: true,
      render: (row: StockMovement) => (
        <div>
          <div className="font-medium">{row.locations?.name || '-'}</div>
          <div className="text-xs text-muted-foreground font-mono">{row.locations?.code}</div>
        </div>
      ),
    },
    {
      key: 'quantity_delta',
      header: 'Qty Change',
      sortable: true,
      className: 'text-right font-mono',
      render: (row: StockMovement) => {
        const isPositive = row.quantity_delta > 0;
        return (
          <span className={`font-semibold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
            {isPositive ? '+' : ''}{row.quantity_delta}
          </span>
        );
      },
    },
    {
      key: 'movement_type',
      header: 'Type',
      render: (row: StockMovement) => (
        <span className="text-sm capitalize">{row.movement_type.replace('_', ' ')}</span>
      ),
    },
    {
      key: 'movement_state',
      header: 'State',
      render: (row: StockMovement) => <StatusChip status={row.movement_state} />,
    },
    {
      key: 'source',
      header: 'Source Document',
      render: (row: StockMovement) => {
        if (!row.source_document_type) return <span className="text-muted-foreground">-</span>;
        return (
          <div className="text-sm">
            <div className="font-medium capitalize">{row.source_document_type}</div>
            {row.source_document_id && (
              <div className="text-xs text-muted-foreground font-mono truncate max-w-[100px]">
                {row.source_document_id.slice(0, 8)}...
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: 'reason_code',
      header: 'Reason',
      render: (row: StockMovement) => (
        <span className="text-sm">{row.reason_code || '-'}</span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (row: StockMovement) => {
        const isReversed = !!row.reversal_ref_id;
        const isPending = row.movement_state === 'pending';
        const canReverse = !isReversed && !isPending;

        return (
          <div className="flex flex-col gap-1 min-w-[100px]">
            {isReversed && (
              <span className="text-xs text-gray-500">Reversed</span>
            )}
            {canReverse && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleReverse(row.id);
                }}
                className="px-3 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded"
              >
                Reverse
              </button>
            )}
            {isPending && (
              <span className="text-xs text-yellow-600">Pending</span>
            )}
          </div>
        );
      },
    },
  ];

  const filterConfig = [
    {
      key: 'movement_type',
      label: 'Movement Type',
      type: 'select' as const,
      options: [
        { value: '', label: 'All' },
        { value: 'receipt', label: 'Receipt' },
        { value: 'issue', label: 'Issue' },
        { value: 'transfer', label: 'Transfer' },
        { value: 'adjustment', label: 'Adjustment' },
        { value: 'cycle_count', label: 'Cycle Count' },
      ],
    },
    {
      key: 'movement_state',
      label: 'State',
      type: 'select' as const,
      options: [
        { value: '', label: 'All' },
        { value: 'pending', label: 'Pending' },
        { value: 'confirmed', label: 'Confirmed' },
        { value: 'reversed', label: 'Reversed' },
      ],
    },
  ];

  return (
    <AppShell>
      <div className="p-6">
        <PageHeader
          title="Stock Movements"
          description="Complete ledger of all inventory transactions"
        />

        <div className="mt-6">
          <FilterBar
            filters={filterConfig}
            values={filters}
            onChange={(key, value) => setFilters(prev => ({ ...prev, [key]: value }))}
          />
        </div>

        <div className="mt-4">
          <DataTable
            columns={columns}
            data={movements}
            loading={loading}
            rowKey={(row) => row.id}
            onRowClick={(row) => setSelectedMovement(row)}
          />
        </div>

        {/* Detail Modal */}
        {selectedMovement && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-2xl w-full">
              <h3 className="text-lg font-semibold mb-4">Movement Details</h3>
              
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Movement ID:</span>
                  <div className="font-mono text-xs mt-1">{selectedMovement.id}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Created:</span>
                  <div className="mt-1">
                    {new Date(selectedMovement.created_at).toLocaleString()}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Item:</span>
                  <div className="mt-1">
                    <div className="font-medium">{selectedMovement.catalog_items?.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {selectedMovement.catalog_items?.sku}
                    </div>
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Location:</span>
                  <div className="mt-1">
                    <div className="font-medium">{selectedMovement.locations?.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {selectedMovement.locations?.code}
                    </div>
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Quantity Delta:</span>
                  <div className={`font-mono font-semibold mt-1 ${
                    selectedMovement.quantity_delta > 0 ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {selectedMovement.quantity_delta > 0 ? '+' : ''}{selectedMovement.quantity_delta}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Type:</span>
                  <div className="mt-1 capitalize">{selectedMovement.movement_type.replace('_', ' ')}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">State:</span>
                  <div className="mt-1">
                    <StatusChip status={selectedMovement.movement_state} />
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Reason Code:</span>
                  <div className="mt-1">{selectedMovement.reason_code || '-'}</div>
                </div>
                {selectedMovement.source_document_type && (
                  <>
                    <div>
                      <span className="text-muted-foreground">Source Type:</span>
                      <div className="mt-1 capitalize">{selectedMovement.source_document_type}</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Source ID:</span>
                      <div className="font-mono text-xs mt-1">{selectedMovement.source_document_id}</div>
                    </div>
                  </>
                )}
                {selectedMovement.reversal_ref_id && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Reversal Reference:</span>
                    <div className="font-mono text-xs mt-1 text-red-600">
                      {selectedMovement.reversal_ref_id}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <button
                  onClick={() => setSelectedMovement(null)}
                  className="px-4 py-2 text-sm bg-gray-200 hover:bg-gray-300 rounded"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
