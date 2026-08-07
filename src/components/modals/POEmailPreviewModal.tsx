'use client';

/**
 * Read-only preview of the vendor email + PDF for a purchase order, surfaced at
 * PO-creation time (before send). Shows exactly what the vendor will receive —
 * recipient, subject, rendered email body, and the actual PDF attachment.
 *
 * This shares the send-time data paths (`po-email` GET + `po-pdf`, both via
 * loadPOContext) so the preview can't drift from what SendPOEmailModal actually
 * sends. It deliberately omits the send controls: no recipient editing, no
 * message box, no send button — creation still happens on the create page, and
 * the real send happens later from SendPOEmailModal. When pricing is pending
 * (request-a-quote lines post unpriced), the rendered email reflects the same
 * request-pricing wording the vendor gets.
 */

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Loader2, Mail, AlertCircle, FileText, Send } from 'lucide-react';
import { buildPurchaseOrderEmail } from '@/lib/email/order-email';

interface PreviewLine {
  description: string;
  quantity: number;
  uom?: string | null;
  unitPrice?: number | null;
}
interface Preview {
  po_number: string;
  vendor_name: string;
  recipient: string | null;
  has_recipient: boolean;
  ship_to: string | null;
  ship_to_address: string | null;
  delivery_label: 'SHIP TO' | 'PICKUP AT';
  needed_by: string | null;
  notes: string | null;
  company_name: string | null;
  lines: PreviewLine[];
  subject: string;
}

interface POEmailPreviewModalProps {
  open: boolean;
  poId: string | null;
  onClose: () => void;
}

const PO_EMAIL_API = '/api/inventory/purchasing/po-email';
const PO_PDF_API = '/api/inventory/purchasing/po-pdf';

export function POEmailPreviewModal({ open, poId, onClose }: POEmailPreviewModalProps) {
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [requester, setRequester] = useState<{ email: string; name: string } | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'email' | 'pdf'>('email');
  // Mount the PDF iframe only once its tab is first opened (avoids generating
  // the PDF up front), then keep it mounted so switching tabs doesn't reload it.
  const [pdfLoaded, setPdfLoaded] = useState(false);

  useEffect(() => {
    if (!open || !poId) return;
    setPreview(null); setError('');
    setTab('email'); setPdfLoaded(false);
    setLoading(true);
    (async () => {
      try {
        const [previewRes, sessionRes] = await Promise.all([
          fetch(`${PO_EMAIL_API}?po_id=${encodeURIComponent(poId)}`),
          fetch('/api/auth/session').then((r) => (r.ok ? r.json() : null)).catch(() => null),
        ]);
        const previewJson = await previewRes.json();
        if (!previewRes.ok) throw new Error(previewJson?.error?.message || 'Failed to load PO preview');
        setPreview(previewJson.data);
        if (sessionRes?.email) setRequester({ email: sessionRes.email, name: sessionRes.name || '' });
      } catch (err: any) {
        setError(err?.message || 'Failed to load PO preview');
      } finally {
        setLoading(false);
      }
    })();
  }, [open, poId]);

  useEffect(() => {
    if (tab === 'pdf') setPdfLoaded(true);
  }, [tab]);

  // Build the exact email the server will send. Unpriced lines (request-a-quote)
  // render with a dash and no order total, which is precisely the request-pricing
  // version the vendor receives.
  const email = useMemo(() => {
    if (!preview) return null;
    return buildPurchaseOrderEmail({
      poNumber: preview.po_number,
      vendorName: preview.vendor_name,
      shipTo: preview.ship_to,
      shipToAddress: preview.ship_to_address,
      deliveryLabel: preview.delivery_label,
      lines: preview.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        uom: l.uom,
        unitPrice: l.unitPrice,
      })),
      neededBy: preview.needed_by,
      notes: preview.notes,
      message: null,
      // Mirror the server: a blank requester name falls back to the company name.
      requesterName: requester?.name?.trim() || preview.company_name || null,
      requesterEmail: requester?.email || preview.recipient || 'you@example.com',
    });
  }, [preview, requester]);

  const emailDoc = useMemo(() => {
    if (!email) return '';
    return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/></head><body style="margin:0;padding:16px;background:#fff;">${email.html}</body></html>`;
  }, [email]);

  // Pricing pending when no line carries a unit price — the vendor is being
  // asked to quote. Drives the request-pricing note on the preview.
  const pricingPending = useMemo(
    () => !!preview && preview.lines.length > 0 && preview.lines.every((l) => l.unitPrice == null),
    [preview],
  );

  if (!open || !poId) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[92vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-white z-10">
          <h3 className="text-lg font-semibold flex items-center gap-2"><Mail className="h-5 w-5" /> Preview vendor email</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        {loading ? (
          <div className="p-10 flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading preview…
          </div>
        ) : preview ? (
          <div className="p-6 space-y-4">
            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />{error}
              </div>
            )}

            {/* What the vendor will receive + who it goes to. */}
            <div className="p-3 bg-blue-50 border border-blue-200 rounded text-sm text-blue-900">
              <div>
                This is what <strong>{preview.vendor_name}</strong> will receive when you place this order.
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-blue-700">To:</span>
                {preview.has_recipient ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white border border-blue-200 px-2.5 py-0.5 text-xs font-medium text-blue-800">
                    <Mail className="h-3 w-3" /> {preview.recipient}
                  </span>
                ) : (
                  <span className="text-amber-700 font-medium">no vendor email yet</span>
                )}
              </div>
            </div>

            {!preview.has_recipient && (
              <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <span>
                  <strong>{preview.vendor_name}</strong> has no contact email on file — you&apos;ll enter one when you
                  send, or{' '}
                  <Link href="/inventory/vendors" className="font-medium underline hover:text-amber-900">
                    add one to the vendor
                  </Link>{' '}
                  now.
                </span>
              </div>
            )}

            {pricingPending && (
              <div className="flex items-start gap-2 p-3 bg-indigo-50 border border-indigo-200 rounded text-sm text-indigo-800">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <span>
                  Pricing is pending — this order asks the vendor to quote each line, so unit prices and the order total
                  show as a dash below (exactly what they receive).
                </span>
              </div>
            )}

            {/* Exact preview of what gets sent: rendered email + the PDF attachment. */}
            <div>
              <div className="flex items-center gap-1 border-b mb-0">
                <button
                  onClick={() => setTab('email')}
                  className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-1.5 transition-colors ${
                    tab === 'email' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Mail className="h-4 w-4" /> Email
                </button>
                <button
                  onClick={() => setTab('pdf')}
                  className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-1.5 transition-colors ${
                    tab === 'pdf' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <FileText className="h-4 w-4" /> PDF attachment
                </button>
              </div>

              {/* Email tab */}
              <div className={tab === 'email' ? 'block' : 'hidden'}>
                <div className="text-xs text-muted-foreground px-1 py-2 space-y-0.5 border-x border-b-0">
                  <div><span className="text-muted-foreground">Subject:</span> <span className="font-medium text-foreground">{email?.subject}</span></div>
                  <div>
                    <span className="text-muted-foreground">To:</span> {preview.recipient || <span className="italic">vendor email (added at send)</span>}
                    {' · '}<span className="text-muted-foreground">Attachment:</span> PO-{preview.po_number}.pdf
                  </div>
                </div>
                <iframe
                  title="Email preview"
                  srcDoc={emailDoc}
                  sandbox=""
                  className="w-full h-[340px] border rounded-md bg-white"
                />
              </div>

              {/* PDF tab */}
              <div className={tab === 'pdf' ? 'block' : 'hidden'}>
                {pdfLoaded ? (
                  <iframe
                    title="PDF preview"
                    src={`${PO_PDF_API}?po_id=${encodeURIComponent(poId)}`}
                    className="w-full h-[460px] border rounded-md bg-gray-100 mt-2"
                  />
                ) : (
                  <div className="h-[460px] flex items-center justify-center text-muted-foreground text-sm mt-2 border rounded-md">
                    <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading PDF…
                  </div>
                )}
              </div>
            </div>

            <p className="text-xs text-muted-foreground flex items-start gap-1.5">
              <Send className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              This is a preview only — nothing is sent yet. The order emails the vendor when you send it from the
              purchasing page (from your name, with you copied).
            </p>

            <div className="flex pt-1">
              <button type="button" onClick={onClose} className="w-full px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50 text-sm">Close preview</button>
            </div>
          </div>
        ) : (
          <div className="p-6">
            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />{error}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
