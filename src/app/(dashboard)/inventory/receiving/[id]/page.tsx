'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';

interface POLine {
  line_id: string;
  line_number: number;
  catalog_item_id: string;
  sku: string;
  item_name: string;
  inventory_type: string;
  qty_ordered: number;
  qty_received: number;
  qty_remaining: number;
  unit_cost: number;
  estimated_unit_cost: number;
  uom: string;
  status: string;
  notes: string;
}

interface PODetail {
  id: string;
  po_number: string;
  vendor_id: string;
  vendor_name: string;
  status: string;
  order_date: string;
  expected_delivery_date: string;
  delivery_location_id: string;
  delivery_location_name: string;
  notes: string;
}

interface ReceiptLine {
  po_line_id: string;
  catalog_item_id: string;
  qty_received: string;
  condition_status: 'accepted' | 'damaged' | 'quarantine' | 'rejected';
  destination_location_id?: string;
  unit_cost_actual?: string;
  notes?: string;
}

export default function ReceiptDetailPage() {
  const router = useRouter();
  const params = useParams();
  const receipt_id = params.id as string;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reversing, setReversing] = useState(false);
  const [poDetail, setPODetail] = useState<PODetail | null>(null);
  const [poLines, setPOLines] = useState<POLine[]>([]);
  const [receiptLines, setReceiptLines] = useState<ReceiptLine[]>([]);
  const [receiptStatus, setReceiptStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetchReceiptAndPO();
  }, [receipt_id]);

  const fetchReceiptAndPO = async () => {
    try {
      setLoading(true);
      
      // Get receipt details (includes PO ID)
      const receiptRes = await fetch(`/api/inventory/receiving/${receipt_id}`);
      const receiptData = await receiptRes.json();
      
      if (!receiptRes.ok) {
        throw new Error(receiptData.error || 'Failed to load receipt');
      }

      const receipt = receiptData.receipt;
      setReceiptStatus(receipt.status);
      
      // Get PO details and lines
      const poRes = await fetch(`/api/supply-chain/purchase-orders/${receipt.po_id}/receiving`);
      const poData = await poRes.json();
      
      if (!poRes.ok) {
        throw new Error(poData.error || 'Failed to load PO');
      }

      setPODetail(poData.po);
      setPOLines(poData.lines || []);
      
      // Initialize receipt lines with defaults (0 qty)
      const initialLines = (poData.lines || []).map((line: POLine) => ({
        po_line_id: line.line_id,
        catalog_item_id: line.catalog_item_id,
        qty_received: '0',
        condition_status: 'accepted' as const,
        destination_location_id: receipt.location_id,
        unit_cost_actual: line.unit_cost?.toString() || line.estimated_unit_cost?.toString() || '',
        notes: ''
      }));
      
      setReceiptLines(initialLines);
    } catch (err: any) {
      console.error('Error loading data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const updateLine = (index: number, field: keyof ReceiptLine, value: any) => {
    setReceiptLines(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const handleSaveDraft = async () => {
    // Save draft functionality can be added later
    alert('Save draft not yet implemented');
  };

  const handleReverseReceipt = async () => {
    if (!confirm('Reverse this receipt? This will undo all inventory changes and reopen the PO for receiving.')) {
      return;
    }

    setReversing(true);
    setError('');

    try {
      const res = await fetch(`/api/inventory/receiving/${receipt_id}/reverse`, {
        method: 'POST'
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to reverse receipt');
      }

      alert('Receipt reversed successfully');
      router.push('/inventory/receiving');
    } catch (err: any) {
      console.error('Error reversing receipt:', err);
      setError(err.message);
    } finally {
      setReversing(false);
    }
  };

  const handleConfirmReceipt = async () => {
    if (!confirm('Confirm this receipt? This will update inventory.')) {
      return;
    }

    setSaving(true);
    setError('');

    try {
      // Filter out lines with 0 quantity
      const nonZeroLines = receiptLines
        .map((line, index) => ({
          ...line,
          line_number: index + 1,
          qty_received: parseFloat(line.qty_received) || 0,
          po_line: poLines[index]
        }))
        .filter(line => line.qty_received > 0);

      if (nonZeroLines.length === 0) {
        throw new Error('At least one line must have quantity > 0');
      }

      // Call confirm receipt API endpoint
      const res = await fetch(`/api/inventory/receiving/${receipt_id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines: nonZeroLines })
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to confirm receipt');
      }
      
      // Update status to confirmed and stay on page (don't redirect)
      setReceiptStatus('confirmed');
      alert('Receipt confirmed successfully! You can now reverse it if needed.');
    } catch (err: any) {
      console.error('Error confirming receipt:', err);
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-96">
          <div className="text-muted-foreground">Loading...</div>
        </div>
      </AppShell>
    );
  }

  if (error || !poDetail) {
    return (
      <AppShell>
        <div className="flex flex-col items-center justify-center h-96 gap-4">
          <div className="text-destructive">{error || 'Failed to load receipt'}</div>
          <button
            onClick={() => router.push('/inventory/receiving')}
            className="px-4 py-2 bg-secondary text-secondary-foreground rounded"
          >
            Back to Receiving
          </button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title={`Receive: ${poDetail.po_number}`}
          description={`Vendor: ${poDetail.vendor_name} | Delivery to: ${poDetail.delivery_location_name}`}
          actions={
            <div className="flex gap-2">
              {receiptStatus === 'confirmed' ? (
                <button
                  onClick={handleReverseReceipt}
                  disabled={reversing}
                  className="px-4 py-2 bg-destructive text-destructive-foreground rounded hover:bg-destructive/90 disabled:opacity-50"
                >
                  {reversing ? 'Reversing...' : 'Reverse Receipt'}
                </button>
              ) : (
                <>
                  <button
                    onClick={handleSaveDraft}
                    disabled={saving}
                    className="px-4 py-2 bg-secondary text-secondary-foreground rounded hover:bg-secondary/80 disabled:opacity-50"
                  >
                    Save Draft
                  </button>
                  <button
                    onClick={handleConfirmReceipt}
                    disabled={saving}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
                  >
                    {saving ? 'Confirming...' : 'Confirm Receipt'}
                  </button>
                </>
              )}
            </div>
          }
        />

        {error && (
          <div className="p-4 bg-destructive/10 border border-destructive rounded text-destructive">
            {error}
          </div>
        )}

        <div className="bg-card border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted">
                <tr>
                  <th className="p-3 text-left text-sm font-medium">Line</th>
                  <th className="p-3 text-left text-sm font-medium">Item</th>
                  <th className="p-3 text-right text-sm font-medium">Ordered</th>
                  <th className="p-3 text-right text-sm font-medium">Previously Received</th>
                  <th className="p-3 text-right text-sm font-medium">Remaining</th>
                  <th className="p-3 text-right text-sm font-medium">Receiving Now</th>
                  <th className="p-3 text-left text-sm font-medium">Condition</th>
                  <th className="p-3 text-left text-sm font-medium">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {poLines.map((poLine, index) => {
                  const line = receiptLines[index];
                  const qtyReceiving = parseFloat(line.qty_received) || 0;
                  const isOverReceiving = qtyReceiving > poLine.qty_remaining;
                  
                  return (
                    <tr key={poLine.line_id} className={qtyReceiving > 0 ? 'bg-blue-50/50' : ''}>
                      <td className="p-3 text-sm">{poLine.line_number}</td>
                      <td className="p-3">
                        <div className="font-medium text-sm">{poLine.item_name}</div>
                        <div className="text-xs text-muted-foreground">{poLine.sku}</div>
                      </td>
                      <td className="p-3 text-right text-sm">{poLine.qty_ordered}</td>
                      <td className="p-3 text-right text-sm">{poLine.qty_received || 0}</td>
                      <td className="p-3 text-right text-sm font-medium">{poLine.qty_remaining}</td>
                      <td className="p-3">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.qty_received}
                          onChange={(e) => updateLine(index, 'qty_received', e.target.value)}
                          className={`w-24 px-2 py-1 text-right border rounded ${
                            isOverReceiving ? 'border-amber-500 bg-amber-50' : 'border-input'
                          }`}
                        />
                        {isOverReceiving && (
                          <div className="text-xs text-amber-600 mt-1">Over-receiving!</div>
                        )}
                      </td>
                      <td className="p-3">
                        <select
                          value={line.condition_status}
                          onChange={(e) => updateLine(index, 'condition_status', e.target.value)}
                          disabled={qtyReceiving === 0}
                          className="px-2 py-1 border border-input rounded text-sm disabled:opacity-50"
                        >
                          <option value="accepted">Accepted</option>
                          <option value="damaged">Damaged</option>
                          <option value="quarantine">Quarantine</option>
                          <option value="rejected">Rejected</option>
                        </select>
                      </td>
                      <td className="p-3">
                        <input
                          type="text"
                          value={line.notes || ''}
                          onChange={(e) => updateLine(index, 'notes', e.target.value)}
                          placeholder="Optional notes"
                          className="w-full px-2 py-1 border border-input rounded text-sm"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-muted p-4 rounded-lg">
          <h3 className="font-medium mb-2">Summary</h3>
          <div className="grid grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">Lines Receiving</div>
              <div className="text-lg font-bold">
                {receiptLines.filter(l => parseFloat(l.qty_received) > 0).length}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Total Qty</div>
              <div className="text-lg font-bold">
                {receiptLines.reduce((sum, l) => sum + (parseFloat(l.qty_received) || 0), 0).toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Accepted</div>
              <div className="text-lg font-bold text-green-600">
                {receiptLines.filter(l => parseFloat(l.qty_received) > 0 && l.condition_status === 'accepted').length}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Damaged/Rejected</div>
              <div className="text-lg font-bold text-red-600">
                {receiptLines.filter(l => parseFloat(l.qty_received) > 0 && ['damaged', 'rejected', 'quarantine'].includes(l.condition_status)).length}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
