'use client';

/**
 * Receive materials against a purchase order.
 *
 * Lists every outstanding line with its remaining quantity pre-filled.
 * Catalog-backed lines create a receipt that auto-posts to inventory stock
 * (rpc_create_receipt_v2). Free-text lines have no stock to post, so confirming
 * just stamps their received quantity directly. Either way the DB triggers move
 * the PO to Partially Received / Received, so a PO that mixes catalog and
 * free-text lines can reach Fully Received.
 */

import { useEffect, useMemo, useState } from 'react';
import { Loader2, PackageCheck, AlertCircle, Printer, Check, Truck } from 'lucide-react';
import { SupplyChainRPC } from '@/lib/rpc/supply-chain';
import { receivePurchaseOrderLines } from '@/lib/api/purchase-orders';
import { useUOMLabelMap } from '@/hooks/useGVTerms';
import { BarcodeLabelDialog, type BarcodeLabelItem } from '@/components/modals/BarcodeLabelDialog';
import {
  type Shipment,
  type ReceiptRef,
  trackingUrl,
  shipDate,
  shipmentRef,
  receiptsForShipment,
  defaultShipmentRef,
  shippedQtyByLine,
} from '@/lib/po/shipments';

interface POLine {
  id: string;
  line_number?: number | null;
  catalog_item_id: string | null;
  item_description?: string | null;
  uom_term_id?: string | null;
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
  // After a successful receive: offer to print labels for what just arrived.
  const [receivedLabels, setReceivedLabels] = useState<BarcodeLabelItem[] | null>(null);
  const [showLabelDialog, setShowLabelDialog] = useState(false);
  // Carrier tracking from the Amazon ship-notice (ASN), surfaced read-only so
  // the receiver can confirm the box that arrived matches what was shipped.
  // An ASN means "shipped", never "received" — this never posts a receipt.
  const [shipments, setShipments] = useState<Shipment[]>([]);
  // Posted receipts already attributed to shipments (for received/unreceived state).
  const [poReceipts, setPoReceipts] = useState<ReceiptRef[]>([]);
  // Which shipment this receipt is attributed to ('' = no specific shipment).
  const [attributedRef, setAttributedRef] = useState<string>('');
  // Vendor packing-slip number off the paperwork in the box (optional).
  const [packingSlipNo, setPackingSlipNo] = useState('');

  // Outstanding quantity per line (numeric strings from PostgREST → coerce).
  const lines = useMemo(() => (po?.purchase_order_lines || []).map((l) => {
    const outstanding = Number(l.qty_ordered) - Number(l.qty_received);
    return { ...l, outstanding: outstanding > 0 ? outstanding : 0 };
  }), [po]);

  // Every line still owing quantity is receivable — catalog lines post to stock,
  // free-text lines are confirmation-only.
  const receivable = lines.filter((l) => l.outstanding > 0);

  // Quantity shipped per PO line (from ship-notices carrying line detail) —
  // shipped-vs-ordered context so the receiver knows what should be in the box.
  const shippedByLine = useMemo(() => shippedQtyByLine(shipments), [shipments]);

  // Lines where the entered quantity exceeds what's still outstanding.
  const isOver = (l: (typeof lines)[number]) => parseFloat(qtyByLine[l.id] || '0') > l.outstanding;
  const hasOverReceipt = receivable.some(isOver);

  // Display info for a line: name + uom, whether it's stock-tracked.
  const lineInfo = (l: (typeof lines)[number]) => {
    if (l.catalog_item_id) {
      const item = catalogItems.get(l.catalog_item_id);
      return {
        name: item?.name || 'Unknown item',
        sku: item?.sku as string | undefined,
        uom: uomLabels[item?.uom_term_id] || '',
        tracked: true,
      };
    }
    return {
      name: l.item_description || 'Custom item',
      sku: undefined as string | undefined,
      uom: l.uom_term_id ? uomLabels[l.uom_term_id] || '' : '',
      tracked: false,
    };
  };

  useEffect(() => {
    if (!open || !po) return;
    setError('');
    setSaving(false);
    setReceivedLabels(null);
    setShowLabelDialog(false);
    setShipments([]);
    setPoReceipts([]);
    setAttributedRef('');
    setPackingSlipNo('');
    // Default every receivable line to its full outstanding quantity.
    const init: Record<string, string> = {};
    for (const l of receivable) init[l.id] = String(l.outstanding);
    setQtyByLine(init);
    // Pull any carrier shipments (ASN) for this PO so the receiver sees
    // "on its way via UPS 1Z…" alongside the lines, plus the receipts already
    // attributed to them. Read-only, best-effort.
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/inventory/purchasing/po-activity?po_id=${po.id}`);
        const json = await res.json();
        if (!cancelled && res.ok) {
          const ships: Shipment[] = json.data?.shipments || [];
          const receipts: ReceiptRef[] = json.data?.receipts || [];
          setShipments(ships);
          setPoReceipts(receipts);
          // Default attribution: most recent shipment nothing was received
          // against yet (receiver can change or clear it).
          setAttributedRef(defaultShipmentRef(ships, receipts) ?? '');
        }
      } catch {
        // Tracking is a convenience — never block receiving on it.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, po?.id]);

  if (!open || !po) return null;

  const receiveAll = () => {
    const next: Record<string, string> = {};
    for (const l of receivable) next[l.id] = String(l.outstanding);
    setQtyByLine(next);
  };

  const handleConfirm = async () => {
    setError('');

    if (hasOverReceipt) {
      setError('One or more lines exceed the outstanding quantity. Reduce them before confirming.');
      return;
    }

    // Split the entered quantities into catalog (post to stock) vs free-text
    // (stamp the line). Free-text lines store an absolute cumulative
    // qty_received, so add the amount received now to what's already received.
    const catalogToReceive = receivable
      .filter((l) => l.catalog_item_id)
      .map((l) => ({ catalog_item_id: l.catalog_item_id as string, qty_received: parseFloat(qtyByLine[l.id] || '0'), po_line_id: l.id }))
      .filter((l) => l.qty_received > 0);

    const freeToReceive = receivable
      .filter((l) => !l.catalog_item_id)
      .map((l) => ({ id: l.id, delta: parseFloat(qtyByLine[l.id] || '0'), current: Number(l.qty_received) }))
      .filter((l) => l.delta > 0)
      .map((l) => ({ id: l.id, qty_received: l.current + l.delta }));

    if (catalogToReceive.length === 0 && freeToReceive.length === 0) {
      setError('Enter a quantity to receive on at least one line.');
      return;
    }
    // Only stock-posting (catalog) receipts need a delivery location.
    if (catalogToReceive.length > 0 && !po.delivery_location_id) {
      setError('This PO has no delivery location set — edit the PO to add one before receiving.');
      return;
    }

    setSaving(true);
    try {
      if (catalogToReceive.length > 0) {
        await SupplyChainRPC.createReceipt({
          location_id: po.delivery_location_id!,
          po_id: po.id,
          auto_post: true,
          // Attribute the receipt to the shipment the receiver picked (ASN
          // shipmentID / tracking number) so tracking links to receiving.
          shipment_ref: attributedRef || null,
          // Vendor packing-slip number as typed by the receiver (empty → null).
          // Kept separate from shipment_ref — a user-entered slip number is
          // never overwritten by carrier-tracking fallbacks.
          packing_slip_no: packingSlipNo.trim() || null,
          lines: catalogToReceive,
        });
      }
      if (freeToReceive.length > 0) {
        const { error: freeErr } = await receivePurchaseOrderLines(po.id, freeToReceive);
        if (freeErr) throw freeErr;
      }
      onReceived();
      // Stay open on a success panel offering labels for what just arrived.
      const labels: BarcodeLabelItem[] = catalogToReceive.flatMap((r) => {
        const item = catalogItems.get(r.catalog_item_id);
        const code = item?.barcode || item?.sku;
        return code ? [{ code, label: item?.name || code, kind: 'stock' as const }] : [];
      });
      setReceivedLabels(labels);
    } catch (err: any) {
      // Surface guardrail errors (e.g. OVER_RECEIPT_BLOCKED) and chassis envelopes
      // ({ error: { message } }) — never render '[object Object]'.
      const raw = err?.error?.message ?? err?.message;
      const base = typeof raw === 'string' && raw ? raw : 'Failed to receive materials.';
      const message = /OVER_RECEIPT/i.test(base) ? `Over-receipt blocked: ${base}` : base;
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

        {/* Success panel: stock is in — suggest printing labels for it */}
        {receivedLabels !== null ? (
          <div className="p-6 space-y-4 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
              <Check className="h-6 w-6 text-green-600" />
            </div>
            <div>
              <h4 className="font-semibold">Received and posted to inventory</h4>
              <p className="text-sm text-muted-foreground mt-1">
                Stock levels and the PO status are updated.
                {receivedLabels.length > 0 && ' Want labels for what just arrived?'}
              </p>
            </div>
            <div className="flex gap-3">
              {receivedLabels.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowLabelDialog(true)}
                  className="flex-1 px-4 py-2 border rounded-md hover:bg-gray-50 text-sm font-medium flex items-center justify-center gap-1.5"
                >
                  <Printer className="h-4 w-4" />
                  Print Labels ({receivedLabels.length})
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm font-medium"
              >
                Done
              </button>
            </div>
            {showLabelDialog && (
              <BarcodeLabelDialog
                items={receivedLabels}
                entityType="item"
                onClose={() => setShowLabelDialog(false)}
              />
            )}
          </div>
        ) : (
        <div className="p-6 space-y-4">
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />{error}
            </div>
          )}

          {/* Carrier tracking from the Amazon ship-notice. Each shipment shows
              whether a receipt was already attributed to it, and the receiver
              picks which shipment this receipt comes from (default: the most
              recent one nothing has been received against). The ASN itself
              still never posts a receipt. */}
          {shipments.length > 0 && (
            <div className="space-y-2">
              {shipments.map((sh, i) => {
                const url = trackingUrl(sh.carrier, sh.tracking_number);
                const ref = shipmentRef(sh);
                const attributed = receiptsForShipment(sh, poReceipts);
                const selectable = !!ref;
                const selected = !!ref && attributedRef === ref;
                return (
                  <label
                    key={i}
                    className={`block p-3 rounded-lg border ${
                      selected ? 'bg-blue-100 border-blue-400' : 'bg-blue-50 border-blue-200'
                    } ${selectable ? 'cursor-pointer' : ''}`}
                  >
                    <div className="flex items-start gap-2">
                      {selectable ? (
                        <input
                          type="radio"
                          name="receive-shipment"
                          checked={selected}
                          onChange={() => setAttributedRef(ref!)}
                          className="mt-0.5 flex-shrink-0 accent-blue-600"
                        />
                      ) : (
                        <Truck className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-blue-900 flex items-center gap-2 flex-wrap">
                          Shipped{sh.carrier ? ` via ${sh.carrier}` : ''}
                          {attributed.length > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full border bg-green-100 text-green-800 border-green-300">
                              Received{attributed[0].receipt_number ? ` · ${attributed[0].receipt_number}` : ''}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-blue-800 mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
                          {sh.tracking_number &&
                            (url ? (
                              <a href={url} target="_blank" rel="noopener noreferrer" className="font-medium underline">
                                Track {sh.tracking_number} ↗
                              </a>
                            ) : (
                              <span>Tracking: {sh.tracking_number}</span>
                            ))}
                          {shipDate(sh.ship_date) && <span>· Shipped {shipDate(sh.ship_date)}</span>}
                          {shipDate(sh.delivery_date) && <span>· Expected {shipDate(sh.delivery_date)}</span>}
                        </div>
                        {selected && (
                          <div className="text-[11px] text-blue-700 mt-1">
                            This receipt will be recorded against this shipment.
                          </div>
                        )}
                      </div>
                    </div>
                  </label>
                );
              })}
              {shipments.some((sh) => shipmentRef(sh)) && (
                <label className="flex items-center gap-2 px-1 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="radio"
                    name="receive-shipment"
                    checked={attributedRef === ''}
                    onChange={() => setAttributedRef('')}
                    className="accent-blue-600"
                  />
                  Not from a specific shipment
                </label>
              )}
            </div>
          )}

          {receivable.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Everything on this PO has already been received.
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
                {receivable.map((l) => {
                  const info = lineInfo(l);
                  const over = isOver(l);
                  return (
                    <div key={l.id} className="p-3 bg-muted/30 rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{info.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {info.sku ? `${info.sku} · ` : ''}{l.outstanding}{info.uom ? ` ${info.uom}` : ''} outstanding
                            {l.line_number != null && shippedByLine[l.line_number] != null && (
                              <span className="ml-1 text-blue-700">
                                · {shippedByLine[l.line_number]} shipped
                              </span>
                            )}
                            {!info.tracked && <span className="ml-1 text-amber-600">· not stock-tracked</span>}
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
                          className={`w-24 shrink-0 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 text-right ${
                            over ? 'border-red-500 focus:ring-red-500' : 'focus:ring-primary'
                          }`}
                        />
                        <span className="text-xs text-muted-foreground w-16 shrink-0">
                          / {Number(l.qty_ordered)}{info.uom ? ` ${info.uom}` : ''}
                        </span>
                      </div>
                      {over && (
                        <p className="mt-1 text-xs text-red-600 text-right">
                          exceeds outstanding ({l.outstanding})
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Vendor packing-slip number off the paperwork in the box —
                  optional, lands on the receipt row for matching/auditing. */}
              <div className="flex items-center gap-3">
                <label htmlFor="receive-packing-slip" className="text-sm text-muted-foreground shrink-0">
                  Packing slip #
                </label>
                <input
                  id="receive-packing-slip"
                  type="text"
                  value={packingSlipNo}
                  maxLength={120}
                  placeholder="Optional — from the vendor's slip"
                  onChange={(e) => setPackingSlipNo(e.target.value)}
                  className="flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                />
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
              disabled={saving || receivable.length === 0 || hasOverReceipt}
              className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 text-sm flex items-center justify-center gap-1.5"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
              {saving ? 'Receiving…' : 'Confirm Receipt'}
            </button>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
