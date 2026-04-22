'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { StatusChip } from '@/components/ui/StatusChip';
import { SupplyChainRPC } from '@/lib/rpc/supply-chain';
import { InventoryRPC } from '@/lib/rpc/inventory';

interface OpenPO {
  po_id: string;
  po_number: string;
  vendor_id: string;
  vendor_name: string;
  order_date: string;
  expected_delivery_date: string;
  delivery_location_id: string;
  delivery_location_name: string;
  delivery_method: string;
  status: string;
  total_lines: number;
  open_lines: number;
  partially_received_lines: number;
  fully_received_lines: number;
  total_ordered_value: number;
  notes: string;
  created_at: string;
}

interface PODetail {
  po_id: string;
  po_number: string;
  vendor_id: string;
  vendor_name: string;
  vendor_code?: string;
  status: string;
  order_date: string;
  expected_delivery_date: string;
  delivery_location_id: string;
  delivery_location_name: string;
  lines: Array<{
    line_id: string;
    line_number: number;
    catalog_item_id: string;
    item_name: string;
    item_sku: string;
    qty_ordered: number;
    qty_received: number;
    qty_remaining: number;
    unit_of_measure: string;
    unit_cost: number;
    condition_status?: string;
    allow_over_delivery?: boolean;
  }>;
}

function ReceivingContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const preselectedPO = searchParams.get('po');

  const [openPOs, setOpenPOs] = useState<OpenPO[]>([]);
  const [recentReceipts, setRecentReceipts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showReceiveModal, setShowReceiveModal] = useState(!!preselectedPO);
  const [selectedPO, setSelectedPO] = useState<string | null>(preselectedPO);
  const [activeTab, setActiveTab] = useState<'open' | 'recent'>('open');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const [openData, recentData] = await Promise.all([
        SupplyChainRPC.getOpenPOsForReceiving(),
        SupplyChainRPC.getRecentReceipts(30)
      ]);
      
      setOpenPOs(openData || []);
      setRecentReceipts(recentData || []);
    } catch (error: any) {
      console.error('Error fetching data:', error);
      setError(error.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleReceiveClick = async (po_id: string) => {
    // Navigate directly to receive page for this PO
    router.push(`?po=${po_id}`);
    setShowReceiveModal(true);
    setSelectedPO(po_id);
  };

  const columns = [
    {
      key: 'po_number',
      header: 'PO Number',
      sortable: true,
      render: (row: OpenPO) => (
        <span className="font-mono">{row.po_number}</span>
      ),
    },
    {
      key: 'vendor',
      header: 'Vendor',
      render: (row: OpenPO) => row.vendor_name || '-',
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: OpenPO) => <StatusChip status={row.status} />,
    },
    {
      key: 'expected_delivery_date',
      header: 'Expected Delivery',
      sortable: true,
      render: (row: OpenPO) => row.expected_delivery_date ? new Date(row.expected_delivery_date).toLocaleDateString() : '-',
    },
    {
      key: 'delivery_location_name',
      header: 'Delivery To',
      render: (row: OpenPO) => row.delivery_location_name || '-',
    },
    {
      key: 'progress',
      header: 'Progress',
      render: (row: OpenPO) => (
        <div>
          <div className="text-xs text-muted-foreground">
            {row.fully_received_lines} of {row.total_lines} fully received
          </div>
          {row.partially_received_lines > 0 && (
            <div className="text-xs text-amber-600">
              {row.partially_received_lines} partial
            </div>
          )}
          {row.open_lines > 0 && (
            <div className="text-xs text-blue-600">
              {row.open_lines} open
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row: OpenPO) => (
        <button
          onClick={() => handleReceiveClick(row.po_id)}
          className="px-3 py-1 bg-primary text-primary-foreground rounded text-sm hover:bg-primary/90"
        >
          Receive
        </button>
      ),
    },
  ];

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Receiving"
          description="Receive inventory from purchase orders. Track partial receipts, handle damaged/rejected items, and update stock levels."
          actions={
            <button
              onClick={() => setShowReceiveModal(true)}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              + Receive Items
            </button>
          }
        />

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-4 gap-4">
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="text-2xl font-bold text-blue-700">
              {openPOs.length}
            </div>
            <div className="text-sm text-blue-600">Open POs</div>
          </div>
          <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="text-2xl font-bold text-green-700">
              {openPOs.reduce((sum, po) => sum + po.fully_received_lines, 0)}
            </div>
            <div className="text-sm text-green-600">Fully Received Lines</div>
          </div>
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="text-2xl font-bold text-amber-700">
              {openPOs.reduce((sum, po) => sum + po.partially_received_lines, 0)}
            </div>
            <div className="text-sm text-amber-600">Partial Lines</div>
          </div>
          <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
            <div className="text-2xl font-bold text-purple-700">
              {openPOs.reduce((sum, po) => sum + po.open_lines, 0)}
            </div>
            <div className="text-sm text-purple-600">Open Lines</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-4 border-b">
          <button
            onClick={() => setActiveTab('open')}
            className={`px-4 py-2 font-medium transition-colors ${
              activeTab === 'open'
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Open POs ({openPOs.length})
          </button>
          <button
            onClick={() => setActiveTab('recent')}
            className={`px-4 py-2 font-medium transition-colors ${
              activeTab === 'recent'
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Recent Receipts ({recentReceipts.length})
          </button>
        </div>

        {activeTab === 'open' ? (
          <DataTable
            data={openPOs}
            columns={columns}
            loading={loading}
            emptyMessage="No open purchase orders found"
            rowKey={(row) => row.po_id}
          />
        ) : (
          <div className="bg-card border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted">
                  <tr>
                    <th className="p-3 text-left text-sm font-medium">Receipt #</th>
                    <th className="p-3 text-left text-sm font-medium">PO #</th>
                    <th className="p-3 text-left text-sm font-medium">Vendor</th>
                    <th className="p-3 text-left text-sm font-medium">Location</th>
                    <th className="p-3 text-right text-sm font-medium">Qty</th>
                    <th className="p-3 text-left text-sm font-medium">Confirmed</th>
                    <th className="p-3 text-left text-sm font-medium">By</th>
                    <th className="p-3 text-left text-sm font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {recentReceipts.map((receipt) => (
                    <tr key={receipt.receipt_id} className="hover:bg-muted/50">
                      <td className="p-3 text-sm font-medium">{receipt.receipt_number}</td>
                      <td className="p-3 text-sm">{receipt.po_number}</td>
                      <td className="p-3 text-sm">{receipt.vendor_name}</td>
                      <td className="p-3 text-sm">{receipt.location_name}</td>
                      <td className="p-3 text-sm text-right">{receipt.total_qty}</td>
                      <td className="p-3 text-sm text-muted-foreground">
                        {new Date(receipt.confirmed_at).toLocaleString()}
                      </td>
                      <td className="p-3 text-sm text-muted-foreground">{receipt.confirmed_by_name}</td>
                      <td className="p-3 text-sm">
                        <button
                          onClick={() => router.push(`/inventory/receiving/${receipt.receipt_id}`)}
                          className="px-3 py-1 bg-secondary text-secondary-foreground rounded text-sm hover:bg-secondary/80"
                        >
                          View / Reverse
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

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
  const [poDetail, setPODetail] = useState<PODetail | null>(null);
  const [locations, setLocations] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(!!poId);
  const [form, setForm] = useState({
    po_id: poId || '',
    location_id: '',
    notes: '',
    packing_slip_no: '',
    lines: [] as Array<{
      po_line_id: string;
      catalog_item_id: string;
      item_name: string;
      qty_ordered: number;
      qty_received_so_far: number;
      qty_remaining: number;
      qty_received: string;
      condition_status: string;
      destination_location_id?: string;
      notes?: string;
    }>,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchLocations();
    if (poId) {
      fetchPO(poId);
    }
  }, [poId]);

  const fetchLocations = async () => {
    try {
      const data = await InventoryRPC.getLocations();
      setLocations(data || []);
    } catch (error) {
      console.error('Error fetching locations:', error);
    }
  };

  const fetchPO = async (id: string) => {
    setLoading(true);
    setError('');
    try {
      const data = await SupplyChainRPC.getPOReceivingDetail(id);
      
      if (data) {
        setPODetail(data);
        setForm({
          ...form,
          po_id: data.po_id,
          location_id: data.delivery_location_id || '',
          lines: data.lines?.map((line: any) => ({
            po_line_id: line.line_id,
            catalog_item_id: line.catalog_item_id,
            item_name: line.item_name,
            qty_ordered: line.qty_ordered,
            qty_received_so_far: line.qty_received,
            qty_remaining: line.qty_remaining,
            qty_received: line.qty_remaining > 0 ? line.qty_remaining.toString() : '', // Auto-populate with remaining qty
            condition_status: 'accepted',
            notes: '',
          })) || [],
        });
      }
    } catch (error: any) {
      console.error('Error fetching PO:', error);
      setError(error.message || 'Failed to load PO details');
      // Close modal after 2 seconds if PO not found
      setTimeout(() => {
        onClose();
      }, 2000);
    } finally {
      setLoading(false);
    }
  };

  const handleFillAllRemaining = () => {
    setForm({
      ...form,
      lines: form.lines.map(line => ({
        ...line,
        qty_received: line.qty_remaining > 0 ? line.qty_remaining.toString() : line.qty_received,
      })),
    });
  };

  const handleClearAll = () => {
    setForm({
      ...form,
      lines: form.lines.map(line => ({
        ...line,
        qty_received: '',
      })),
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
      const linesToReceive = form.lines
        .filter(l => l.qty_received && parseFloat(l.qty_received) > 0)
        .map(l => ({
          catalog_item_id: l.catalog_item_id,
          qty_received: parseFloat(l.qty_received),
          po_line_id: l.po_line_id,
          condition_status: l.condition_status,
          destination_location_id: l.destination_location_id || undefined,
          notes: l.notes || undefined,
        }));

      if (linesToReceive.length === 0) {
        setError('Please enter quantities to receive');
        setSaving(false);
        return;
      }

      const result = await SupplyChainRPC.createReceipt({
        po_id: form.po_id || null,
        location_id: form.location_id,
        packing_slip_no: form.packing_slip_no || null,
        notes: form.notes || null,
        status: 'confirmed',
        source_type: 'delivery',
        auto_post: true,
        lines: linesToReceive,
      });

      console.log('Receipt created:', result);
      onComplete();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-5xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b sticky top-0 bg-white z-10">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-semibold">
              {poDetail ? `Receive PO: ${poDetail.po_number}` : 'Receive Items'}
            </h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">
              ✕
            </button>
          </div>
          {poDetail && (
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span>
                <strong>Vendor:</strong> {poDetail.vendor_name}
                {poDetail.vendor_code && ` (${poDetail.vendor_code})`}
              </span>
              <span>•</span>
              <span>
                <strong>Status:</strong> {poDetail.status}
              </span>
              {poDetail.expected_delivery_date && (
                <>
                  <span>•</span>
                  <span>
                    <strong>Expected:</strong> {new Date(poDetail.expected_delivery_date).toLocaleDateString()}
                  </span>
                </>
              )}
            </div>
          )}
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

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Receive To Location *</label>
                <select
                  value={form.location_id}
                  onChange={(e) => setForm({ ...form, location_id: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  required
                >
                  <option value="">Select location...</option>
                  {locations.map(loc => (
                    <option key={loc.id} value={loc.id}>{loc.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Packing Slip #</label>
                <input
                  type="text"
                  value={form.packing_slip_no}
                  onChange={(e) => setForm({ ...form, packing_slip_no: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="e.g., PS-12345"
                  autoFocus
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                rows={2}
                placeholder="Additional notes (optional)"
              />
            </div>

            {form.lines.length > 0 && (
              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-medium">Line Items ({form.lines.length})</h4>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleFillAllRemaining}
                      className="text-sm px-3 py-1 border border-primary text-primary rounded hover:bg-primary/5"
                    >
                      Fill All Remaining
                    </button>
                    <button
                      type="button"
                      onClick={handleClearAll}
                      className="text-sm px-3 py-1 border border-gray-300 text-gray-600 rounded hover:bg-gray-50"
                    >
                      Clear All
                    </button>
                  </div>
                </div>
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {form.lines.map((line, index) => {
                    const hasQty = line.qty_received && parseFloat(line.qty_received) > 0;
                    return (
                      <div 
                        key={index} 
                        className={`p-3 rounded-lg border-2 transition-colors ${
                          hasQty 
                            ? 'border-green-300 bg-green-50/50' 
                            : 'border-gray-200 bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="font-medium flex items-center gap-2">
                            {hasQty && <span className="text-green-600">✓</span>}
                            {line.item_name}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            Ordered: <strong>{line.qty_ordered}</strong> | 
                            Received: <strong>{line.qty_received_so_far}</strong> | 
                            Remaining: <strong className="text-orange-600">{line.qty_remaining}</strong>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="block text-xs text-muted-foreground mb-1">Qty Received *</label>
                            <input
                              type="number"
                              value={line.qty_received}
                              onChange={(e) => updateLine(index, 'qty_received', e.target.value)}
                              className="w-full px-2 py-1.5 border rounded text-sm focus:ring-2 focus:ring-green-500"
                              min="0"
                              step="0.01"
                              max={line.qty_remaining}
                              placeholder="0"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-muted-foreground mb-1">Condition</label>
                            <select
                              value={line.condition_status}
                              onChange={(e) => updateLine(index, 'condition_status', e.target.value)}
                              className="w-full px-2 py-1.5 border rounded text-sm"
                            >
                              <option value="accepted">✓ Accepted</option>
                              <option value="damaged">⚠ Damaged</option>
                              <option value="quarantine">🔒 Quarantine</option>
                              <option value="rejected">✗ Rejected</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-muted-foreground mb-1">Destination</label>
                            <select
                              value={line.destination_location_id || ''}
                              onChange={(e) => updateLine(index, 'destination_location_id', e.target.value)}
                              className="w-full px-2 py-1.5 border rounded text-sm"
                            >
                              <option value="">Default</option>
                              {locations.map(loc => (
                                <option key={loc.id} value={loc.id}>{loc.name}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div className="mt-2">
                          <input
                            type="text"
                            value={line.notes || ''}
                            onChange={(e) => updateLine(index, 'notes', e.target.value)}
                            className="w-full px-2 py-1.5 border rounded text-xs"
                            placeholder="Line notes (optional)"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-4 border-t sticky bottom-0 bg-white pb-2">
              <button 
                type="button" 
                onClick={onClose} 
                className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 px-4 py-2.5 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors flex items-center justify-center gap-2"
              >
                {saving ? (
                  <>
                    <span className="animate-spin">⟳</span>
                    Processing...
                  </>
                ) : (
                  <>
                    <span>✓</span>
                    Complete Receipt
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default function ReceivingPage() {
  return (
    <Suspense fallback={
      <AppShell>
        <PageHeader title="Receiving" description="Loading..." />
        <div className="p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-10 bg-gray-200 rounded" />
            <div className="h-32 bg-gray-200 rounded" />
          </div>
        </div>
      </AppShell>
    }>
      <ReceivingContent />
    </Suspense>
  );
}
