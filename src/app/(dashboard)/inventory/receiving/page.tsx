'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/FilterBar';
import { StatusChip } from '@/components/ui/StatusChip';

interface Receipt {
  id: string;
  purchase_order_id?: string;
  location_id?: string;
  received_by?: string;
  received_at: string;
  notes?: string;
  purchase_orders?: {
    id: string;
    po_number: string;
    vendor_id?: string;
    vendors?: { name: string };
  };
  locations?: { id: string; name: string };
  receipt_lines?: Array<{
    id: string;
    purchase_order_line_id?: string;
    catalog_item_id?: string;
    qty_received: number;
    qty_accepted: number;
    qty_rejected: number;
    rejection_reason?: string;
    catalog_items?: { id: string; name: string; sku: string };
  }>;
}

interface PurchaseOrder {
  id: string;
  po_number: string;
  status: string;
  vendors?: { name: string };
  purchase_order_lines?: Array<{
    id: string;
    catalog_item_id: string;
    qty_ordered: number;
    qty_received: number;
    catalog_items?: { id: string; name: string; sku: string };
  }>;
}

export default function ReceivingPage() {
  const searchParams = useSearchParams();
  const preselectedPO = searchParams.get('po');

  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [openPOs, setOpenPOs] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [showReceiveModal, setShowReceiveModal] = useState(!!preselectedPO);
  const [selectedPO, setSelectedPO] = useState<string | null>(preselectedPO);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [receiptsRes, posRes] = await Promise.all([
        fetch('/api/inventory/receiving'),
        fetch('/api/inventory/purchasing?status=approved'),
      ]);

      const { data: receiptsData } = await receiptsRes.json();
      const { data: posData } = await posRes.json();

      setReceipts(receiptsData || []);
      setOpenPOs(posData || []);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const columns = [
    {
      key: 'received_at',
      header: 'Received',
      sortable: true,
      render: (row: Receipt) => new Date(row.received_at).toLocaleString(),
    },
    {
      key: 'po',
      header: 'PO Number',
      render: (row: Receipt) => (
        <span className="font-mono">{row.purchase_orders?.po_number || 'Direct Receipt'}</span>
      ),
    },
    {
      key: 'vendor',
      header: 'Vendor',
      render: (row: Receipt) => row.purchase_orders?.vendors?.name || '-',
    },
    {
      key: 'location',
      header: 'Location',
      render: (row: Receipt) => row.locations?.name || '-',
    },
    {
      key: 'lines',
      header: 'Items',
      render: (row: Receipt) => (
        <div>
          <div>{row.receipt_lines?.length || 0} line(s)</div>
          <div className="text-xs text-muted-foreground">
            {row.receipt_lines?.reduce((sum, l) => sum + l.qty_accepted, 0) || 0} accepted
          </div>
        </div>
      ),
    },
    {
      key: 'rejected',
      header: 'Rejected',
      render: (row: Receipt) => {
        const rejected = row.receipt_lines?.reduce((sum, l) => sum + l.qty_rejected, 0) || 0;
        return rejected > 0 ? (
          <span className="text-red-600 font-medium">{rejected}</span>
        ) : (
          <span className="text-muted-foreground">0</span>
        );
      },
    },
  ];

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Receiving"
          description="Log incoming inventory from purchase orders. Example: Record receipt of 250 tons of concrete mix delivered to the South Yard, updating stock levels and marking the PO line as partially received."
          actions={
            <button
              onClick={() => setShowReceiveModal(true)}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              + Receive Items
            </button>
          }
        />

        {openPOs.length > 0 && (
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h3 className="font-medium text-blue-800 mb-2">Open Purchase Orders</h3>
            <div className="flex flex-wrap gap-2">
              {openPOs.slice(0, 5).map((po) => (
                <button
                  key={po.id}
                  onClick={() => {
                    setSelectedPO(po.id);
                    setShowReceiveModal(true);
                  }}
                  className="px-3 py-1 bg-white border border-blue-300 rounded text-sm hover:bg-blue-100"
                >
                  {po.po_number} - {po.vendors?.name}
                </button>
              ))}
              {openPOs.length > 5 && (
                <span className="px-3 py-1 text-sm text-blue-600">
                  +{openPOs.length - 5} more
                </span>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-4">
          <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="text-2xl font-bold text-green-700">
              {receipts.length}
            </div>
            <div className="text-sm text-green-600">Total Receipts</div>
          </div>
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="text-2xl font-bold text-blue-700">
              {receipts.reduce((sum, r) => sum + (r.receipt_lines?.reduce((s, l) => s + l.qty_accepted, 0) || 0), 0)}
            </div>
            <div className="text-sm text-blue-600">Items Received</div>
          </div>
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="text-2xl font-bold text-red-700">
              {receipts.reduce((sum, r) => sum + (r.receipt_lines?.reduce((s, l) => s + l.qty_rejected, 0) || 0), 0)}
            </div>
            <div className="text-sm text-red-600">Items Rejected</div>
          </div>
        </div>

        <DataTable
          data={receipts}
          columns={columns}
          loading={loading}
          emptyMessage="No receipts found"
          rowKey={(row) => row.id}
        />

        {showReceiveModal && (
          <ReceiveModal
            poId={selectedPO}
            onClose={() => {
              setShowReceiveModal(false);
              setSelectedPO(null);
            }}
            onComplete={() => {
              setShowReceiveModal(false);
              setSelectedPO(null);
              fetchData();
            }}
          />
        )}
      </div>
    </AppShell>
  );
}

function ReceiveModal({ poId, onClose, onComplete }: { poId: string | null; onClose: () => void; onComplete: () => void }) {
  const [po, setPO] = useState<PurchaseOrder | null>(null);
  const [loading, setLoading] = useState(!!poId);
  const [form, setForm] = useState({
    purchase_order_id: poId || '',
    location_id: '',
    notes: '',
    lines: [] as Array<{
      purchase_order_line_id: string;
      catalog_item_id: string;
      item_name: string;
      qty_ordered: number;
      qty_previously_received: number;
      qty_received: string;
      qty_accepted: string;
      qty_rejected: string;
      rejection_reason: string;
    }>,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (poId) {
      fetchPO(poId);
    }
  }, [poId]);

  const fetchPO = async (id: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/inventory/purchasing?status=approved`);
      const { data } = await res.json();
      const selectedPO = data?.find((p: PurchaseOrder) => p.id === id);
      if (selectedPO) {
        setPO(selectedPO);
        setForm({
          ...form,
          purchase_order_id: selectedPO.id,
          lines: selectedPO.purchase_order_lines?.map((line: any) => ({
            purchase_order_line_id: line.id,
            catalog_item_id: line.catalog_item_id,
            item_name: line.catalog_items?.name || 'Unknown',
            qty_ordered: line.qty_ordered,
            qty_previously_received: line.qty_received,
            qty_received: '',
            qty_accepted: '',
            qty_rejected: '0',
            rejection_reason: '',
          })) || [],
        });
      }
    } catch (error) {
      console.error('Error fetching PO:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateLine = (index: number, field: string, value: string) => {
    const newLines = [...form.lines];
    newLines[index] = { ...newLines[index], [field]: value };

    // Auto-calculate accepted if received changes
    if (field === 'qty_received') {
      const received = parseInt(value) || 0;
      const rejected = parseInt(newLines[index].qty_rejected) || 0;
      newLines[index].qty_accepted = String(Math.max(0, received - rejected));
    }
    if (field === 'qty_rejected') {
      const received = parseInt(newLines[index].qty_received) || 0;
      const rejected = parseInt(value) || 0;
      newLines[index].qty_accepted = String(Math.max(0, received - rejected));
    }

    setForm({ ...form, lines: newLines });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      const res = await fetch('/api/inventory/receiving', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purchase_order_id: form.purchase_order_id || null,
          location_id: form.location_id,
          notes: form.notes || null,
          lines: form.lines
            .filter(l => l.qty_received && parseInt(l.qty_received) > 0)
            .map(l => ({
              purchase_order_line_id: l.purchase_order_line_id,
              catalog_item_id: l.catalog_item_id,
              qty_received: parseInt(l.qty_received),
              qty_accepted: parseInt(l.qty_accepted),
              qty_rejected: parseInt(l.qty_rejected) || 0,
              rejection_reason: l.rejection_reason || null,
            })),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create receipt');
      }

      onComplete();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-white">
          <h3 className="text-lg font-semibold">
            {po ? `Receive: ${po.po_number}` : 'Receive Items'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        {loading ? (
          <div className="p-6">
            <div className="animate-pulse space-y-4">
              <div className="h-10 bg-gray-200 rounded" />
              <div className="h-32 bg-gray-200 rounded" />
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-1">Receive To Location *</label>
              <input
                type="text"
                value={form.location_id}
                onChange={(e) => setForm({ ...form, location_id: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
                placeholder="Location UUID"
                required
              />
            </div>

            {form.lines.length > 0 && (
              <div className="border-t pt-4">
                <h4 className="font-medium mb-3">Line Items</h4>
                <div className="space-y-3">
                  {form.lines.map((line, index) => (
                    <div key={index} className="p-3 bg-muted/30 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-medium">{line.item_name}</div>
                        <div className="text-sm text-muted-foreground">
                          Ordered: {line.qty_ordered} | Previously received: {line.qty_previously_received}
                        </div>
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        <div>
                          <label className="block text-xs text-muted-foreground mb-1">Received</label>
                          <input
                            type="number"
                            value={line.qty_received}
                            onChange={(e) => updateLine(index, 'qty_received', e.target.value)}
                            className="w-full px-2 py-1.5 border rounded text-sm"
                            min="0"
                            max={line.qty_ordered - line.qty_previously_received}
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-muted-foreground mb-1">Accepted</label>
                          <input
                            type="number"
                            value={line.qty_accepted}
                            onChange={(e) => updateLine(index, 'qty_accepted', e.target.value)}
                            className="w-full px-2 py-1.5 border rounded text-sm bg-green-50"
                            min="0"
                            readOnly
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-muted-foreground mb-1">Rejected</label>
                          <input
                            type="number"
                            value={line.qty_rejected}
                            onChange={(e) => updateLine(index, 'qty_rejected', e.target.value)}
                            className="w-full px-2 py-1.5 border rounded text-sm bg-red-50"
                            min="0"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-muted-foreground mb-1">Reason</label>
                          <input
                            type="text"
                            value={line.rejection_reason}
                            onChange={(e) => updateLine(index, 'rejection_reason', e.target.value)}
                            className="w-full px-2 py-1.5 border rounded text-sm"
                            placeholder="If rejected..."
                            disabled={!line.qty_rejected || line.qty_rejected === '0'}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

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
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50">
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
              >
                {saving ? 'Processing...' : 'Complete Receipt'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
