'use client';

/**
 * Receive materials against a purchase order.
 *
 * One modal lists each catalog-backed line with the quantity still outstanding
 * pre-filled. "Receive All" fills every line; edit a number for a partial
 * delivery. Confirm creates a receipt that auto-posts to inventory stock
 * (rpc_create_receipt_v2), and the DB triggers move the PO to
 * Partially Received / Received automatically.
 */

import { useEffect, useMemo, useState } from 'react';
import { Loader2, PackageCheck, AlertCircle } from 'lucide-react';
import { SupplyChainRPC } from '@/lib/rpc/supply-chain';
import { updatePurchaseOrderStatus } from '@/lib/api/purchase-orders';
import { useUOMLabelMap } from '@/hooks/useGVTerms';

interface POLine {
  id: string;
  catalog_item_id: string;
  qty_ordered: number;
  qty_received: number;
  unit_cost: number;
  status: string;
}

interface ReceivePOModalProps {
  open: boolean;
  po: {
    id: string;
    po_number: string;
    delivery_location_id?: string;
    last_event_id: string;
    purchase_order_lines?: POLine[];
  } | null;
  catalogItems: Map<string, any>;
  onClose: () => void;
  onReceived: () => void;
}

export function ReceivePOModal({ open, po, catalogItems, onClose, onReceived }: ReceivePOModalProps) {
  const uomLabels = useUOMLabelMap();
  const [qtyByLine, setQtyByLine] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Outstanding quantity per line (numeric strings from PostgREST → coerce).
  const lines = useMemo(() => (po?.purchase_order_lines || []).map((l) => {
    const outstanding = Number(l.qty_ordered) - Number(l.qty_received);
    return { ...l, outstanding: outstanding > 0 ? outstanding : 0 };
  }), [po]);

  const receivableLines = lines.filter((l) => l.catalog_item_id && l.outstanding > 0);
  const hasCatalogLine = lines.some((l) => l.catalog_item_id);

  useEffect(() => {
    if (!open || !po) return;
    setError('');
    setSaving(false);
    // Default every receivable line to its full outstanding quantity.
    const init: Record<string, string> = {};
    for (const l of receivableLines) init[l.id] = String(l.outstanding);
    setQtyByLine(init);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, po?.id]);

  if (!open || !po) return null;

  const receiveAll = () => {
    const next: Record<string, string> = {};
    for (const l of receivableLines) next[l.id] = String(l.outstanding);
    setQtyByLine(next);
  };

  const handleConfirm = async () => {
    setError('');
    if (!po.delivery_location_id) {
      setError('This PO has no delivery location set — edit the PO to add one before receiving.');
      return;
    }

    const receiptLines = receivableLines
      .map((l) => ({
        catalog_item_id: l.catalog_item_id,
        qty_received: parseFloat(qtyByLine[l.id] || '0'),
        po_line_id: l.id,
      }))
      .filter((l) => l.qty_received > 0);

    setSaving(true);
    try {
      if (receiptLines.length === 0) {
        if (hasCatalogLine) {
          setError('Enter a quantity to receive on at least one line.');
          setSaving(false);
          return;
        }
        // Free-text-only PO: nothing to post to stock — just mark it received.
        // Must be 'fully_received' (the stored status); 'received' is not a valid
        // purchase_orders.status and violates purchase_orders_status_check.
        const { error: statusError } = await updatePurchaseOrderStatus(po.id, 'fully_received', po.last_event_id);
        if (statusError) throw statusError;
      } else {
        await SupplyChainRPC.createReceipt({
          location_id: po.delivery_location_id,
          po_id: po.id,
          auto_post: true,
          lines: receiptLines,
        });
      }
      onReceived();
      onClose();
    } catch (err: any) {
      // Surface guardrail errors (e.g. OVER_RECEIPT_BLOCKED) and chassis envelopes.
      const message = err?.message || err?.error?.message || 'Failed to receive materials.';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-white">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <PackageCheck className="h-5 w-5" /> Receive — {po.po_number}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <div className="p-6 space-y-4">
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />{error}
            </div>
          )}

          {receivableLines.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {hasCatalogLine
                ? 'Everything on this PO has already been received.'
                : 'This PO has no stock-tracked items. Confirm to mark it received.'}
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  Quantity defaults to what&apos;s still outstanding.
                </span>
                <button
                  type="button"
                  onClick={receiveAll}
                  className="text-sm text-primary hover:underline font-medium"
                >
                  Receive All
                </button>
              </div>

              <div className="space-y-2">
                {receivableLines.map((l) => {
                  const item = catalogItems.get(l.catalog_item_id);
                  const uom = uomLabels[item?.uom_term_id] || '';
                  return (
                    <div key={l.id} className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{item?.name || 'Unknown item'}</div>
                        <div className="text-xs text-muted-foreground">
                          {item?.sku ? `${item.sku} · ` : ''}{l.outstanding} {uom} outstanding
                        </div>
                      </div>
                      <input
                        type="number"
                        value={qtyByLine[l.id] ?? ''}
                        min="0"
                        max={l.outstanding}
                        step="0.01"
                        onChange={(e) =>
                          setQtyByLine((prev) => ({ ...prev, [l.id]: e.target.value }))
                        }
                        className="w-24 shrink-0 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-right"
                      />
                      <span className="text-xs text-muted-foreground w-16 shrink-0">
                        / {Number(l.qty_ordered)} {uom}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={saving}
              className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 text-sm flex items-center justify-center gap-1.5"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
              {saving ? 'Receiving…' : 'Confirm Receipt'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
