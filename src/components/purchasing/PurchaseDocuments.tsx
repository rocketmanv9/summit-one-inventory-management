'use client';

/**
 * Receipt repository for a purchase order.
 *
 * Lists collected purchasing documents (receipts, invoices, order
 * confirmations, shipping/delivery notices, packing slips, …) with a signed
 * link to open each original. "Collect from Gmail" searches the connected
 * mailbox for this PO's documents; "Upload" attaches a file manually. Matched
 * documents can be reconciled onto the PO so its numbers reflect the invoiced
 * actuals.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Loader2, RefreshCw, Upload, FileText, ExternalLink, CheckCircle2,
  ReceiptText, Truck, PackageCheck, FileCheck2, ScrollText,
} from 'lucide-react';

interface PurchaseDocument {
  id: string;
  doc_type: string;
  source: string;
  sender_email: string | null;
  document_date: string | null;
  file_name: string | null;
  vendor_name: string | null;
  invoice_number: string | null;
  order_number: string | null;
  tracking_numbers: string[] | null;
  total: number | null;
  tax: number | null;
  currency: string | null;
  extraction_status: string;
  match_status: string;
  match_confidence: number | null;
  reconciled_at: string | null;
  created_at: string;
  signed_url: string | null;
}

const LIST_API = '/api/inventory/purchasing/documents';
const COLLECT_API = '/api/inventory/purchasing/documents/collect';
const UPLOAD_API = '/api/inventory/purchasing/documents/upload';
const RECONCILE_API = '/api/inventory/purchasing/documents/reconcile';

const DOC_META: Record<string, { label: string; Icon: typeof FileText }> = {
  order_confirmation: { label: 'Order confirmation', Icon: FileCheck2 },
  receipt: { label: 'Receipt', Icon: ReceiptText },
  invoice: { label: 'Invoice', Icon: FileText },
  shipping_notification: { label: 'Shipping notice', Icon: Truck },
  delivery_confirmation: { label: 'Delivery', Icon: PackageCheck },
  packing_slip: { label: 'Packing slip', Icon: ScrollText },
  credit_memo: { label: 'Credit memo', Icon: FileText },
  warranty: { label: 'Warranty', Icon: FileText },
  other: { label: 'Document', Icon: FileText },
};

function idem() {
  return { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() };
}

export function PurchaseDocuments({ poId, onChanged }: { poId: string; onChanged?: () => void }) {
  const [docs, setDocs] = useState<PurchaseDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [collecting, setCollecting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${LIST_API}?po_id=${poId}`);
      const json = await res.json();
      if (res.ok) setDocs(json.data || []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [poId]);

  useEffect(() => {
    load();
  }, [load]);

  const collect = async () => {
    setCollecting(true);
    setNote('');
    try {
      const res = await fetch(COLLECT_API, { method: 'POST', headers: idem(), body: JSON.stringify({ po_id: poId }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || 'Collection failed');
      const d = json.data;
      setNote(
        d.collected > 0
          ? `${d.collected} document${d.collected === 1 ? '' : 's'} found · ${d.matched} matched · ${d.suggested} to review · ${d.reconciled} reconciled`
          : `Scanned ${d.scanned} email${d.scanned === 1 ? '' : 's'} — nothing new to attach.`,
      );
      await load();
      onChanged?.();
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Collection failed');
    } finally {
      setCollecting(false);
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) e.target.value = '';
    if (!file) return;
    setUploading(true);
    setNote('');
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error('Could not read file'));
        r.readAsDataURL(file);
      });
      const res = await fetch(UPLOAD_API, {
        method: 'POST',
        headers: idem(),
        body: JSON.stringify({ po_id: poId, file_data: dataUrl, file_name: file.name }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || 'Upload failed');
      setNote('Document uploaded and extracted.');
      await load();
      onChanged?.();
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const reconcile = async (id: string) => {
    setActing(id);
    setNote('');
    try {
      const res = await fetch(RECONCILE_API, { method: 'POST', headers: idem(), body: JSON.stringify({ document_id: id }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || 'Reconcile failed');
      const d = json.data;
      setNote(`Reconciled to PO — ${d?.lines_updated ?? 0} line(s) updated, total now $${Number(d?.total_after ?? 0).toFixed(2)}.`);
      await load();
      onChanged?.();
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Reconcile failed');
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="border-t pt-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-medium flex items-center gap-1.5">
          <ReceiptText className="h-4 w-4 text-emerald-600" /> Documents
        </h4>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="px-2.5 py-1 border rounded-md hover:bg-gray-50 disabled:opacity-50 text-xs flex items-center gap-1.5"
          >
            {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />} Upload
          </button>
          <button
            onClick={collect}
            disabled={collecting}
            className="px-2.5 py-1 border rounded-md hover:bg-gray-50 disabled:opacity-50 text-xs flex items-center gap-1.5"
          >
            <RefreshCw className={`h-3 w-3 ${collecting ? 'animate-spin' : ''}`} /> Collect from Gmail
          </button>
        </div>
      </div>
      <input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={onFile} />

      {note && <p className="text-xs text-muted-foreground mb-2">{note}</p>}

      {loading ? (
        <div className="p-3 bg-muted/30 rounded-lg animate-pulse h-12" />
      ) : docs.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          No documents yet. “Collect from Gmail” searches your connected mailbox for this PO’s
          receipts and invoices; “Upload” attaches one manually.
        </p>
      ) : (
        <div className="space-y-2">
          {docs.map((doc) => {
            const meta = DOC_META[doc.doc_type] ?? DOC_META.other;
            const reconciled = !!doc.reconciled_at;
            const canReconcile = !reconciled && (doc.match_status === 'matched' || doc.match_status === 'suggested');
            return (
              <div key={doc.id} className="p-3 bg-muted/30 rounded-lg">
                <div className="flex items-start gap-2">
                  <meta.Icon className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate">{meta.label}</span>
                      <MatchTag status={doc.match_status} confidence={doc.match_confidence} reconciled={reconciled} />
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-2">
                      {doc.invoice_number && <span>Inv #{doc.invoice_number}</span>}
                      {doc.order_number && <span>· Order {doc.order_number}</span>}
                      {doc.total != null && <span>· ${Number(doc.total).toFixed(2)}</span>}
                      {doc.document_date && <span>· {doc.document_date}</span>}
                    </div>
                    {doc.tracking_numbers && doc.tracking_numbers.length > 0 && (
                      <div className="text-xs text-muted-foreground mt-0.5">Tracking: {doc.tracking_numbers.join(', ')}</div>
                    )}
                    <div className="flex items-center gap-3 mt-1.5">
                      {doc.signed_url && (
                        <a
                          href={doc.signed_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary underline inline-flex items-center gap-1"
                        >
                          <ExternalLink className="h-3 w-3" /> Open
                        </a>
                      )}
                      {canReconcile && (
                        <button
                          onClick={() => reconcile(doc.id)}
                          disabled={acting === doc.id}
                          className="text-xs text-emerald-700 underline inline-flex items-center gap-1 disabled:opacity-50"
                        >
                          {acting === doc.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                          Reconcile to PO
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MatchTag({ status, confidence, reconciled }: { status: string; confidence: number | null; reconciled: boolean }) {
  if (reconciled) {
    return <span className="text-[10px] px-1.5 py-0.5 rounded-full border bg-green-100 text-green-800 border-green-300">Reconciled</span>;
  }
  const pct = confidence != null ? ` ${Math.round(confidence * 100)}%` : '';
  const map: Record<string, { label: string; cls: string }> = {
    matched: { label: `Matched${pct}`, cls: 'bg-green-100 text-green-800 border-green-300' },
    suggested: { label: `Review${pct}`, cls: 'bg-amber-100 text-amber-800 border-amber-300' },
    unmatched: { label: 'Unmatched', cls: 'bg-gray-100 text-gray-600 border-gray-300' },
    dismissed: { label: 'Dismissed', cls: 'bg-gray-100 text-gray-600 border-gray-300' },
    superseded: { label: 'Superseded', cls: 'bg-gray-100 text-gray-600 border-gray-300' },
  };
  const m = map[status] ?? map.unmatched;
  return <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${m.cls}`}>{m.label}</span>;
}
