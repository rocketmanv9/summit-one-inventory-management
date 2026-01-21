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
    catalog_items?: { id: string; name: string; sku: string };
  }>;
}

export default function TransfersPage() {
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedTransfer, setSelectedTransfer] = useState<Transfer | null>(null);

  useEffect(() => {
    fetchTransfers();
  }, [filters]);

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
    if (!confirm('Confirm receipt of this transfer?')) return;

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
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleReceive(row.id);
              }}
              className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded hover:bg-green-200"
            >
              Receive
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

        <div className="grid grid-cols-4 gap-4">
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
      </div>
    </AppShell>
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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
    } finally {
      setSaving(false);
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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">From Location *</label>
              <input
                type="text"
                value={form.from_location_id}
                onChange={(e) => setForm({ ...form, from_location_id: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
                placeholder="Location UUID"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">To Location *</label>
              <input
                type="text"
                value={form.to_location_id}
                onChange={(e) => setForm({ ...form, to_location_id: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
                placeholder="Location UUID"
                required
              />
            </div>
          </div>

          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium">Line Items</h4>
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
                  <input
                    type="text"
                    value={line.catalog_item_id}
                    onChange={(e) => updateLine(index, 'catalog_item_id', e.target.value)}
                    className="flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
                    placeholder="Item UUID"
                  />
                  <input
                    type="number"
                    value={line.qty}
                    onChange={(e) => updateLine(index, 'qty', e.target.value)}
                    className="w-24 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="Qty"
                    min="1"
                  />
                  {form.lines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeLine(index)}
                      className="text-red-500 hover:text-red-700"
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
        </form>
      </div>
    </div>
  );
}
