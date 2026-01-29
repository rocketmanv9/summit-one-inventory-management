'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/FilterBar';
import { StatusChip } from '@/components/ui/StatusChip';

interface Transfer {
  id: string;
  status: string;
  notes?: string;
  created_at: string;
  shipped_at?: string;
  received_at?: string;
  from_location?: { id: string; name: string; location_type: string };
  to_location?: { id: string; name: string; location_type: string };
  transfer_lines?: Array<{
    id: string;
    catalog_item_id: string;
    qty: number;
    qty_shipped?: number;
    qty_received?: number;
    catalog_items?: { id: string; name: string; sku: string };
  }>;
}

export default function TransfersPage() {
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingTransfer, setEditingTransfer] = useState<Transfer | null>(null);
  const [selectedTransfer, setSelectedTransfer] = useState<Transfer | null>(null);
  const [showPartialReceiveModal, setShowPartialReceiveModal] = useState(false);
  const [partialReceiveTransfer, setPartialReceiveTransfer] = useState<Transfer | null>(null);
  const [showFixMistakeModal, setShowFixMistakeModal] = useState(false);
  const [fixMistakeTransfer, setFixMistakeTransfer] = useState<Transfer | null>(null);

  useEffect(() => {
    fetchTransfers();
  }, [filters.status]); // Only depend on the specific filter value, not the whole object

  const fetchTransfers = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.status) params.set('status', filters.status);

      const res = await fetch(`/api/inventory/transfers?${params}`);
      const { data } = await res.json();
      setTransfers(data || []);
    } catch (error) {
      console.error('Error fetching transfers:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleShip = async (transferId: string) => {
    if (!confirm('Ship this transfer?')) return;

    try {
      const res = await fetch(`/api/inventory/transfers/${transferId}/ship`, {
        method: 'POST',
      });
      if (res.ok) {
        fetchTransfers();
      }
    } catch (error) {
      console.error('Error shipping transfer:', error);
    }
  };

  const handleReceive = async (transferId: string) => {
    if (!confirm('Confirm full receipt of this transfer?')) return;

    try {
      const res = await fetch(`/api/inventory/transfers/${transferId}/receive`, {
        method: 'POST',
      });
      if (res.ok) {
        fetchTransfers();
      }
    } catch (error) {
      console.error('Error receiving transfer:', error);
    }
  };

  const handlePartialReceive = async (transferId: string) => {
    const transfer = transfers.find(t => t.id === transferId);
    if (!transfer) return;
    
    setPartialReceiveTransfer(transfer);
    setShowPartialReceiveModal(true);
  };

  const handleFixMistake = (transferId: string) => {
    const transfer = transfers.find(t => t.id === transferId);
    if (!transfer) return;
    
    setFixMistakeTransfer(transfer);
    setShowFixMistakeModal(true);
  };

  const handleReturn = async (transferId: string) => {
    if (!confirm('Create a return transfer (physical movement back)? This creates a new transfer in the opposite direction.')) return;

    try {
      const res = await fetch(`/api/inventory/transfers/${transferId}/reverse`, {
        method: 'POST',
      });
      if (res.ok) {
        alert('Return transfer created in draft status. Ship and receive it to complete the physical return.');
        fetchTransfers();
      }
    } catch (error) {
      console.error('Error creating return transfer:', error);
    }
  };

  const handleCancel = async (transferId: string) => {
    if (!confirm('Cancel this transfer?')) return;

    try {
      const res = await fetch(`/api/inventory/transfers/${transferId}/cancel`, {
        method: 'POST',
      });
      if (res.ok) {
        fetchTransfers();
      }
    } catch (error) {
      console.error('Error cancelling transfer:', error);
    }
  };

  const handleUndoCancel = async (transferId: string) => {
    if (!confirm('Undo cancellation? This will restore the transfer to draft status.')) return;

    try {
      const res = await fetch(`/api/inventory/transfers/${transferId}/undo-cancel`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID()
        },
        body: JSON.stringify({
          last_event_id: `undo_cancel_${transferId}_${crypto.randomUUID()}`
        })
      });
      
      const result = await res.json();
      
      if (!res.ok) {
        alert(`Error: ${result.error}`);
        return;
      }
      
      alert('Cancellation reversed successfully!');
      fetchTransfers();
    } catch (error) {
      console.error('Error undoing cancellation:', error);
      alert('Failed to undo cancellation. Please try again.');
    }
  };

  const columns = [
    {
      key: 'id',
      header: 'Transfer #',
      render: (row: Transfer) => (
        <span className="font-mono text-sm">{row.id.slice(0, 8).toUpperCase()}</span>
      ),
    },
    {
      key: 'from_location',
      header: 'From',
      render: (row: Transfer) => (
        <div>
          <div className="font-medium">{row.from_location?.name || '-'}</div>
          <div className="text-xs text-muted-foreground capitalize">
            {row.from_location?.location_type?.replace('_', ' ') || ''}
          </div>
        </div>
      ),
    },
    {
      key: 'to_location',
      header: 'To',
      render: (row: Transfer) => (
        <div>
          <div className="font-medium">{row.to_location?.name || '-'}</div>
          <div className="text-xs text-muted-foreground capitalize">
            {row.to_location?.location_type?.replace('_', ' ') || ''}
          </div>
        </div>
      ),
    },
    {
      key: 'items',
      header: 'Items',
      render: (row: Transfer) => (
        <div>
          <div>{row.transfer_lines?.length || 0} line(s)</div>
          <div className="text-xs text-muted-foreground">
            {row.transfer_lines?.reduce((sum, line) => sum + line.qty, 0) || 0} units
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: Transfer) => (
        <StatusChip status={row.status} />
      ),
    },
    {
      key: 'created_at',
      header: 'Created',
      sortable: true,
      render: (row: Transfer) => new Date(row.created_at).toLocaleDateString(),
    },
    {
      key: 'actions',
      header: '',
      render: (row: Transfer) => (
        <div className="flex gap-2">
          {row.status === 'draft' && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingTransfer(row);
                  setShowEditModal(true);
                }}
                className="px-2 py-1 text-xs bg-gray-100 text-gray-800 rounded hover:bg-gray-200"
              >
                Edit
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleShip(row.id);
                }}
                className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded hover:bg-blue-200"
              >
                Ship
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleCancel(row.id);
                }}
                className="px-2 py-1 text-xs bg-gray-100 text-gray-800 rounded hover:bg-gray-200"
              >
                Cancel
              </button>
            </>
          )}
          {row.status === 'in_transit' && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleReceive(row.id);
                }}
                className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded hover:bg-green-200"
              >
                Full Receive
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handlePartialReceive(row.id);
                }}
                className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded hover:bg-blue-200"
              >
                Partial
              </button>
            </>
          )}
          {(row.status === 'partially_received') && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handlePartialReceive(row.id);
              }}
              className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded hover:bg-blue-200"
            >
              Receive More
            </button>
          )}
          {(row.status === 'in_transit' || row.status === 'partially_received' || row.status === 'completed') && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleFixMistake(row.id);
              }}
              className="px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded hover:bg-yellow-200"
            >
              Fix Mistake
            </button>
          )}
          {row.status === 'completed' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleReturn(row.id);
              }}
              className="px-2 py-1 text-xs bg-orange-100 text-orange-800 rounded hover:bg-orange-200"
            >
              Return
            </button>
          )}
          {row.status === 'cancelled' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleUndoCancel(row.id);
              }}
              className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded hover:bg-blue-200"
              title="Restore to draft status"
            >
              Undo Cancel
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
        { value: 'draft', label: 'Draft' },
        { value: 'in_transit', label: 'In Transit' },
        { value: 'partially_received', label: 'Partially Received' },
        { value: 'completed', label: 'Completed' },
        { value: 'cancelled', label: 'Cancelled' },
      ],
    },
  ];

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Transfers"
          description="Manage inventory transfers between locations. Example: Transfer 50 tons of aggregate from Main Yard to Truck #7 for delivery to the I-95 paving project, or move excess rebar from Job Site A back to the warehouse."
          actions={
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              + Create Transfer
            </button>
          }
        />

        <div className="grid grid-cols-5 gap-4">
          <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
            <div className="text-2xl font-bold text-gray-700">
              {transfers.filter(t => t.status === 'draft').length}
            </div>
            <div className="text-sm text-gray-600">Draft</div>
          </div>
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="text-2xl font-bold text-blue-700">
              {transfers.filter(t => t.status === 'in_transit').length}
            </div>
            <div className="text-sm text-blue-600">In Transit</div>
          </div>
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="text-2xl font-bold text-amber-700">
              {transfers.filter(t => t.status === 'partially_received').length}
            </div>
            <div className="text-sm text-amber-600">Partially Received</div>
          </div>
          <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="text-2xl font-bold text-green-700">
              {transfers.filter(t => t.status === 'completed').length}
            </div>
            <div className="text-sm text-green-600">Completed</div>
          </div>
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="text-2xl font-bold text-red-700">
              {transfers.filter(t => t.status === 'cancelled').length}
            </div>
            <div className="text-sm text-red-600">Cancelled</div>
          </div>
        </div>

        <FilterBar
          filters={filterConfig}
          values={filters}
          onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
          onClear={() => setFilters({})}
        />

        <DataTable
          data={transfers}
          columns={columns}
          loading={loading}
          emptyMessage="No transfers found"
          rowKey={(row) => row.id}
          onRowClick={setSelectedTransfer}
        />

        {selectedTransfer && (
          <TransferDetailPanel
            transfer={selectedTransfer}
            onClose={() => setSelectedTransfer(null)}
          />
        )}

        {showCreateModal && (
          <CreateTransferModal
            onClose={() => setShowCreateModal(false)}
            onCreated={() => {
              setShowCreateModal(false);
              fetchTransfers();
            }}
          />
        )}

        {showEditModal && editingTransfer && (
          <EditTransferModal
            transfer={editingTransfer}
            onClose={() => {
              setShowEditModal(false);
              setEditingTransfer(null);
            }}
            onUpdated={() => {
              setShowEditModal(false);
              setEditingTransfer(null);
              fetchTransfers();
            }}
          />
        )}

        {showPartialReceiveModal && partialReceiveTransfer && (
          <PartialReceiveModal
            transfer={partialReceiveTransfer}
            onClose={() => {
              setShowPartialReceiveModal(false);
              setPartialReceiveTransfer(null);
            }}
            onReceived={() => {
              setShowPartialReceiveModal(false);
              setPartialReceiveTransfer(null);
              fetchTransfers();
            }}
          />
        )}

        {showFixMistakeModal && fixMistakeTransfer && (
          <FixMistakeModal
            transfer={fixMistakeTransfer}
            onClose={() => {
              setShowFixMistakeModal(false);
              setFixMistakeTransfer(null);
            }}
            onFixed={() => {
              setShowFixMistakeModal(false);
              setFixMistakeTransfer(null);
              fetchTransfers();
            }}
          />
        )}
      </div>
    </AppShell>
  );
}

function PartialReceiveModal({ transfer, onClose, onReceived }: { transfer: Transfer; onClose: () => void; onReceived: () => void }) {
  const [currentTransfer, setCurrentTransfer] = useState(transfer);
  const [loading, setLoading] = useState(true);
  const [lineQuantities, setLineQuantities] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Fetch fresh transfer data to get current qty_received values
  useEffect(() => {
    const fetchTransferData = async () => {
      try {
        const res = await fetch(`/api/inventory/transfers/${transfer.id}`);
        if (!res.ok) {
          // Fallback to using provided transfer data if endpoint not available
          console.warn('Could not fetch fresh transfer data, using cached data');
          setCurrentTransfer(transfer);
          const initialQuantities = (transfer.transfer_lines || []).reduce((acc: Record<string, number>, line: any) => {
            const shipped = line.qty_shipped || line.qty;
            const received = line.qty_received || 0;
            const remaining = shipped - received;
            acc[line.id] = remaining > 0 ? remaining : 0;
            return acc;
          }, {});
          setLineQuantities(initialQuantities);
          setLoading(false);
          return;
        }
        
        const { data } = await res.json();
        if (data) {
          setCurrentTransfer(data);
          // Initialize line quantities with remaining amounts
          const initialQuantities = (data.transfer_lines || []).reduce((acc: Record<string, number>, line: any) => {
            const shipped = line.qty_shipped || line.qty;
            const received = line.qty_received || 0;
            const remaining = shipped - received;
            acc[line.id] = remaining > 0 ? remaining : 0;
            return acc;
          }, {});
          setLineQuantities(initialQuantities);
        }
      } catch (err) {
        console.error('Error fetching transfer:', err);
        // Fallback to using provided transfer data
        setCurrentTransfer(transfer);
        const initialQuantities = (transfer.transfer_lines || []).reduce((acc: Record<string, number>, line: any) => {
          const shipped = line.qty_shipped || line.qty;
          const received = line.qty_received || 0;
          const remaining = shipped - received;
          acc[line.id] = remaining > 0 ? remaining : 0;
          return acc;
        }, {});
        setLineQuantities(initialQuantities);
      } finally {
        setLoading(false);
      }
    };
    fetchTransferData();
  }, [transfer.id, transfer.transfer_lines]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      // Filter out lines with 0 quantity
      const quantities = Object.entries(lineQuantities)
        .filter(([_, qty]) => qty > 0)
        .reduce((acc, [lineId, qty]) => {
          acc[lineId] = qty;
          return acc;
        }, {} as Record<string, number>);

      if (Object.keys(quantities).length === 0) {
        setError('Please enter at least one quantity to receive');
        setSaving(false);
        return;
      }

      const res = await fetch(`/api/inventory/transfers/${transfer.id}/receive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ line_quantities: quantities }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to receive transfer');
      }

      onReceived();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const updateQuantity = (lineId: string, value: string) => {
    const numValue = value === '' ? 0 : parseInt(value);
    setLineQuantities({ ...lineQuantities, [lineId]: numValue });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-200">
          <h3 className="text-lg font-semibold">Receive Transfer Partially</h3>
          <p className="text-sm text-gray-600 mt-1">
            Enter the quantity received for each line. You can receive in multiple batches.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {loading ? (
            <div className="text-center py-8 text-gray-500">Loading transfer data...</div>
          ) : (
            <div className="space-y-3">
              <h4 className="font-medium text-sm text-gray-700">Line Items</h4>
              {(currentTransfer.transfer_lines || []).map((line) => {
                const shipped = line.qty_shipped || line.qty;
                const alreadyReceived = line.qty_received || 0;
                const remaining = shipped - alreadyReceived;
              
              return (
                <div key={line.id} className="p-3 bg-gray-50 rounded-md">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex-1">
                      <div className="font-medium text-sm">
                        {line.catalog_items?.name || 'Unknown Item'}
                      </div>
                      <div className="text-xs text-gray-600">
                        SKU: {line.catalog_items?.sku || '-'}
                      </div>
                    </div>
                    <div className="text-right text-xs text-gray-600">
                      <div>Shipped: {shipped}</div>
                      <div>Already Received: {alreadyReceived}</div>
                      <div className="font-medium text-gray-900">Remaining: {remaining}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-gray-700">Receive now:</label>
                    <input
                      type="number"
                      value={lineQuantities[line.id] || ''}
                      onChange={(e) => updateQuantity(line.id, e.target.value)}
                      className="w-24 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                      min="0"
                      max={remaining}
                      placeholder="0"
                    />
                    <span className="text-xs text-gray-500">/ {remaining} remaining</span>
                  </div>
                </div>
              );
            })}
            </div>
          )}

          <div className="flex gap-3 pt-4 border-t">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? 'Receiving...' : 'Receive Items'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FixMistakeModal({ transfer, onClose, onFixed }: { transfer: Transfer; onClose: () => void; onFixed: () => void }) {
  const [mode, setMode] = useState<'select' | 'undo-ship' | 'reverse-receipt' | 'return'>('select');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const reasons = {
    'undo-ship': [
      'Accidentally clicked Ship',
      'Wrong transfer shipped',
      'Items not actually shipped',
      'Other'
    ],
    'reverse-receipt': [
      'Wrong quantity received',
      'Wrong location',
      'Wrong item',
      'Duplicate entry',
      'Items not actually received',
      'Other'
    ]
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason) {
      setError('Please select a reason');
      return;
    }

    setSaving(true);
    setError('');

    try {
      let endpoint = '';
      let successMessage = '';

      if (mode === 'undo-ship') {
        endpoint = `/api/inventory/transfers/${transfer.id}/undo-ship`;
        successMessage = 'Shipment undone. Transfer reverted to draft.';
      } else if (mode === 'reverse-receipt') {
        endpoint = `/api/inventory/transfers/${transfer.id}/reverse-receipt`;
        successMessage = 'Receipt reversed. Stock corrected and transfer reverted to in-transit.';
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, notes: notes || null }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to fix mistake');
      }

      alert(successMessage);
      onFixed();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (mode === 'select') {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full">
          <div className="p-6 border-b border-gray-200">
            <h3 className="text-lg font-semibold">Fix Mistake</h3>
            <p className="text-sm text-gray-600 mt-1">
              Transfer #{transfer.id.slice(0, 8)} - Status: {transfer.status}
            </p>
          </div>

          <div className="p-6">
            <div className="mb-6">
              <h4 className="font-medium text-gray-900 mb-2">Did the inventory physically move?</h4>
              <p className="text-sm text-gray-600 mb-4">
                Choose the correct action based on what actually happened in the real world.
              </p>
            </div>

            <div className="space-y-3">
              {transfer.status === 'in_transit' && (
                <button
                  onClick={() => setMode('undo-ship')}
                  className="w-full p-4 border-2 border-gray-200 rounded-lg hover:border-yellow-500 hover:bg-yellow-50 text-left transition-colors"
                >
                  <div className="font-medium text-gray-900">❌ No - Undo Shipment (Correction)</div>
                  <div className="text-sm text-gray-600 mt-1">
                    Items were never physically shipped. Reverts to draft status.
                  </div>
                  <div className="text-xs text-yellow-700 mt-2 font-medium">
                    ⚠️ Accounting correction only - does not move inventory
                  </div>
                </button>
              )}

              {(transfer.status === 'completed' || transfer.status === 'partially_received') && (
                <button
                  onClick={() => setMode('reverse-receipt')}
                  className="w-full p-4 border-2 border-gray-200 rounded-lg hover:border-yellow-500 hover:bg-yellow-50 text-left transition-colors"
                >
                  <div className="font-medium text-gray-900">❌ No - Reverse Receipt (Correction)</div>
                  <div className="text-sm text-gray-600 mt-1">
                    Items were never physically received (wrong qty/location/item/duplicate).
                  </div>
                  <div className="text-xs text-yellow-700 mt-2 font-medium">
                    ⚠️ Creates corrective stock movements - does not create physical shipment
                  </div>
                </button>
              )}

              {transfer.status === 'completed' && (
                <button
                  onClick={() => {
                    onClose();
                    // Trigger return directly
                    if (confirm('Create a return transfer (physical movement back)? This creates a new transfer in the opposite direction.')) {
                      fetch(`/api/inventory/transfers/${transfer.id}/reverse`, {
                        method: 'POST',
                      }).then(() => {
                        alert('Return transfer created in draft status. Ship and receive it to complete the physical return.');
                        onFixed();
                      });
                    }
                  }}
                  className="w-full p-4 border-2 border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 text-left transition-colors"
                >
                  <div className="font-medium text-gray-900">✅ Yes - Return Inventory (Physical Move)</div>
                  <div className="text-sm text-gray-600 mt-1">
                    Items physically went from A → B, now need to physically return B → A.
                  </div>
                  <div className="text-xs text-blue-700 mt-2 font-medium">
                    📦 Creates a new transfer for the physical return shipment
                  </div>
                </button>
              )}
            </div>
          </div>

          <div className="p-6 border-t flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full">
        <div className="p-6 border-b border-gray-200">
          <h3 className="text-lg font-semibold">
            {mode === 'undo-ship' ? 'Undo Shipment' : 'Reverse Receipt'}
          </h3>
          <p className="text-sm text-gray-600 mt-1">
            Transfer #{transfer.id.slice(0, 8)}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-md">
            <p className="text-sm text-yellow-800 font-medium">
              ⚠️ {mode === 'undo-ship' ? 'Accounting correction only. Does not move inventory.' : 'Creates corrective stock movements. Does not create physical shipment.'}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Reason *</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              required
            >
              <option value="">Select reason...</option>
              {reasons[mode as keyof typeof reasons]?.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Additional Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              rows={3}
              placeholder="Optional: Provide additional details about this correction..."
            />
          </div>

          <div className="flex gap-3 pt-4 border-t">
            <button
              type="button"
              onClick={() => setMode('select')}
              className="flex-1 px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700 disabled:opacity-50"
            >
              {saving ? 'Processing...' : mode === 'undo-ship' ? 'Undo Shipment' : 'Reverse Receipt'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TransferDetailPanel({ transfer, onClose }: { transfer: Transfer; onClose: () => void }) {
  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-white shadow-xl border-l z-40 overflow-y-auto">
      <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-white">
        <h3 className="font-semibold">Transfer Details</h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
      </div>

      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <span className="font-mono">{transfer.id.slice(0, 8).toUpperCase()}</span>
          <StatusChip status={transfer.status} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="p-3 bg-muted/30 rounded-lg">
            <div className="text-xs text-muted-foreground">From</div>
            <div className="font-medium">{transfer.from_location?.name}</div>
          </div>
          <div className="p-3 bg-muted/30 rounded-lg">
            <div className="text-xs text-muted-foreground">To</div>
            <div className="font-medium">{transfer.to_location?.name}</div>
          </div>
        </div>

        <div className="border-t pt-4">
          <h4 className="font-medium mb-2">Line Items</h4>
          <div className="space-y-2">
            {transfer.transfer_lines?.map((line) => (
              <div key={line.id} className="flex items-center justify-between p-2 bg-muted/30 rounded">
                <div>
                  <div className="font-medium">{line.catalog_items?.name || 'Unknown Item'}</div>
                  <div className="text-xs text-muted-foreground">{line.catalog_items?.sku}</div>
                </div>
                <div className="font-mono">{line.qty}</div>
              </div>
            )) || <p className="text-muted-foreground text-sm">No items</p>}
          </div>
        </div>

        {transfer.notes && (
          <div className="border-t pt-4">
            <h4 className="font-medium mb-2">Notes</h4>
            <p className="text-sm text-muted-foreground">{transfer.notes}</p>
          </div>
        )}

        <div className="border-t pt-4">
          <h4 className="font-medium mb-2">Timeline</h4>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-gray-400 rounded-full" />
              <span>Created: {new Date(transfer.created_at).toLocaleString()}</span>
            </div>
            {transfer.shipped_at && (
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-blue-400 rounded-full" />
                <span>Shipped: {new Date(transfer.shipped_at).toLocaleString()}</span>
              </div>
            )}
            {transfer.received_at && (
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-green-400 rounded-full" />
                <span>Received: {new Date(transfer.received_at).toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CreateTransferModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    from_location_id: '',
    to_location_id: '',
    notes: '',
    lines: [{ catalog_item_id: '', qty: '' }],
  });
  const [locations, setLocations] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Load locations on mount
  useEffect(() => {
    const loadLocations = async () => {
      try {
        const locsRes = await fetch('/api/inventory/locations');
        const locsData = await locsRes.json();
        setLocations(locsData.data || []);
      } catch (err) {
        console.error('[CreateTransferModal] Error loading locations:', err);
      } finally {
        setLoadingData(false);
      }
    };
    loadLocations();
  }, []);

  // Load items when from_location changes
  useEffect(() => {
    const loadItemsAtLocation = async () => {
      if (!form.from_location_id) {
        setItems([]);
        return;
      }

      setLoadingItems(true);
      try {
        const itemsRes = await fetch(`/api/inventory/locations/${form.from_location_id}/items`);
        const itemsData = await itemsRes.json();
        setItems(itemsData.data || []);
      } catch (err) {
        console.error('[CreateTransferModal] Error loading items:', err);
        setItems([]);
      } finally {
        setLoadingItems(false);
      }
    };
    loadItemsAtLocation();
  }, [form.from_location_id]);

  const addLine = () => {
    setForm({
      ...form,
      lines: [...form.lines, { catalog_item_id: '', qty: '' }],
    });
  };

  const removeLine = (index: number) => {
    setForm({
      ...form,
      lines: form.lines.filter((_, i) => i !== index),
    });
  };

  const updateLine = (index: number, field: string, value: string) => {
    const newLines = [...form.lines];
    newLines[index] = { ...newLines[index], [field]: value };
    setForm({ ...form, lines: newLines });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Prevent double submission
    if (saving) return;
    
    setSaving(true);
    setError('');

    try {
      const res = await fetch('/api/inventory/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_location_id: form.from_location_id,
          to_location_id: form.to_location_id,
          notes: form.notes || null,
          lines: form.lines
            .filter(l => l.catalog_item_id && l.qty)
            .map(l => ({
              catalog_item_id: l.catalog_item_id,
              qty: parseInt(l.qty),
            })),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create transfer');
      }

      onCreated();
    } catch (err: any) {
      setError(err.message);
      setSaving(false); // Re-enable form on error
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-white">
          <h3 className="text-lg font-semibold">Create Transfer</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">
              {error}
            </div>
          )}

          {loadingData ? (
            <div className="py-8 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
              <p className="mt-2 text-sm text-gray-500">Loading locations...</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">From Location *</label>
                  <select
                    value={form.from_location_id}
                    onChange={(e) => {
                      setForm({ 
                        ...form, 
                        from_location_id: e.target.value,
                        lines: [{ catalog_item_id: '', qty: '' }] // Reset lines when location changes
                      });
                    }}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    required
                  >
                    <option value="">Select location...</option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name} ({typeof loc.location_type === 'string' ? loc.location_type : loc.location_type?.name || ''})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">To Location *</label>
                  <select
                    value={form.to_location_id}
                    onChange={(e) => setForm({ ...form, to_location_id: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    required
                  >
                    <option value="">Select location...</option>
                    {locations.filter(loc => loc.id !== form.from_location_id).map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name} ({typeof loc.location_type === 'string' ? loc.location_type : loc.location_type?.name || ''})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium">Line Items *</h4>
                  <button
                    type="button"
                    onClick={addLine}
                    className="text-sm text-primary hover:underline"
                    disabled={!form.from_location_id || loadingItems}
                  >
                    + Add Line
                  </button>
                </div>
                <div className="space-y-2">
                  {form.lines.map((line, index) => (
                    <div key={index} className="flex gap-2 items-center">
                      <select
                        value={line.catalog_item_id}
                        onChange={(e) => updateLine(index, 'catalog_item_id', e.target.value)}
                        className="flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                        required
                        disabled={!form.from_location_id || loadingItems}
                      >
                        <option value="">
                          {!form.from_location_id 
                            ? 'Select from location first...' 
                            : loadingItems 
                            ? 'Loading items...' 
                            : items.length === 0 
                            ? 'No items with stock at this location' 
                            : 'Select item...'}
                        </option>
                        {items.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} ({item.sku}) - Available: {item.qty_available} {item.unit_of_measure}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        value={line.qty}
                        onChange={(e) => updateLine(index, 'qty', e.target.value)}
                        className="w-24 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                        placeholder="Qty"
                        min="1"
                        required
                      />
                      {form.lines.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeLine(index)}
                          className="text-red-500 hover:text-red-700 px-2"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  rows={2}
                  placeholder="Optional notes about this transfer..."
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
                >
                  {saving ? 'Creating...' : 'Create Transfer'}
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}

function EditTransferModal({ transfer, onClose, onUpdated }: { transfer: Transfer; onClose: () => void; onUpdated: () => void }) {
  const [form, setForm] = useState<{
    from_location_id: string;
    to_location_id: string;
    notes: string;
    lines: Array<{ id?: string; catalog_item_id: string; qty: string }>;
  }>({
    from_location_id: transfer.from_location?.id || '',
    to_location_id: transfer.to_location?.id || '',
    notes: transfer.notes || '',
    lines: transfer.transfer_lines?.map(line => ({
      id: line.id,
      catalog_item_id: line.catalog_item_id,
      qty: line.qty.toString(),
    })) || [{ catalog_item_id: '', qty: '' }],
  });
  const [locations, setLocations] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Load locations on mount
  useEffect(() => {
    const loadLocations = async () => {
      try {
        const locsRes = await fetch('/api/inventory/locations');
        const locsData = await locsRes.json();
        setLocations(locsData.data || []);
      } catch (err) {
        console.error('Error loading locations:', err);
      } finally {
        setLoadingData(false);
      }
    };
    loadLocations();
  }, []);

  // Load items when from_location changes
  useEffect(() => {
    const loadItemsAtLocation = async () => {
      if (!form.from_location_id) {
        setItems([]);
        return;
      }

      setLoadingItems(true);
      try {
        const itemsRes = await fetch(`/api/inventory/locations/${form.from_location_id}/items`);
        const itemsData = await itemsRes.json();
        setItems(itemsData.data || []);
      } catch (err) {
        console.error('Error loading items:', err);
        setItems([]);
      } finally {
        setLoadingItems(false);
      }
    };
    loadItemsAtLocation();
  }, [form.from_location_id]);

  const addLine = () => {
    setForm({
      ...form,
      lines: [...form.lines, { catalog_item_id: '', qty: '' }],
    });
  };

  const removeLine = (index: number) => {
    setForm({
      ...form,
      lines: form.lines.filter((_, i) => i !== index),
    });
  };

  const updateLine = (index: number, field: string, value: string) => {
    const newLines = [...form.lines];
    newLines[index] = { ...newLines[index], [field]: value };
    setForm({ ...form, lines: newLines });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      const res = await fetch(`/api/inventory/transfers/${transfer.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_location_id: form.from_location_id,
          to_location_id: form.to_location_id,
          notes: form.notes || null,
          lines: form.lines
            .filter(l => l.catalog_item_id && l.qty)
            .map(l => ({
              ...(l.id && { id: l.id }),
              catalog_item_id: l.catalog_item_id,
              qty: parseInt(l.qty),
            })),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update transfer');
      }

      onUpdated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-white">
          <h3 className="text-lg font-semibold">Edit Transfer</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">
              {error}
            </div>
          )}

          {loadingData ? (
            <div className="py-8 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
              <p className="mt-2 text-sm text-gray-500">Loading locations and items...</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">From Location *</label>
                  <select
                    value={form.from_location_id}
                    onChange={(e) => setForm({ ...form, from_location_id: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    required
                  >
                    <option value="">Select location...</option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name} ({typeof loc.location_type === 'string' ? loc.location_type : loc.location_type?.name || ''})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">To Location *</label>
                  <select
                    value={form.to_location_id}
                    onChange={(e) => setForm({ ...form, to_location_id: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    required
                  >
                    <option value="">Select location...</option>
                    {locations.filter(loc => loc.id !== form.from_location_id).map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name} ({typeof loc.location_type === 'string' ? loc.location_type : loc.location_type?.name || ''})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium">Line Items *</h4>
                  <button
                    type="button"
                    onClick={addLine}
                    className="text-sm text-primary hover:underline"
                  >
                    + Add Line
                  </button>
                </div>
                <div className="space-y-2">
                  {form.lines.map((line, index) => (
                    <div key={index} className="flex gap-2 items-center">
                      <select
                        value={line.catalog_item_id}
                        onChange={(e) => updateLine(index, 'catalog_item_id', e.target.value)}
                        className="flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                        required
                      >
                        <option value="">Select item...</option>
                        {items.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} ({item.sku}) - {item.unit_of_measure}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        value={line.qty}
                        onChange={(e) => updateLine(index, 'qty', e.target.value)}
                        className="w-24 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                        placeholder="Qty"
                        min="1"
                        required
                      />
                      {form.lines.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeLine(index)}
                          className="text-red-500 hover:text-red-700 px-2"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  rows={2}
                  placeholder="Optional notes about this transfer..."
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
