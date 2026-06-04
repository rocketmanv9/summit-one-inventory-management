'use client';

/**
 * Review & email a purchase order to its vendor.
 *
 * Shows an exact preview of what will be sent: the rendered email (built with
 * the same buildPurchaseOrderEmail() the server uses, so it updates live as the
 * message is typed) and the actual PDF attachment (streamed from the po-pdf
 * route). The user edits the recipient + message, then sends from their own
 * address (CC'd back to them).
 */

import { useState, useEffect, useMemo } from 'react';
import { Loader2, Mail, CheckCircle2, AlertCircle, FileText } from 'lucide-react';
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
  needed_by: string | null;
  notes: string | null;
  company_name: string | null;
  lines: PreviewLine[];
  subject: string;
}

interface SendPOEmailModalProps {
  open: boolean;
  poId: string | null;
  onClose: () => void;
  onSent?: () => void;
}

const PO_EMAIL_API = '/api/inventory/purchasing/po-email';
const PO_PDF_API = '/api/inventory/purchasing/po-pdf';

export function SendPOEmailModal({ open, poId, onClose, onSent }: SendPOEmailModalProps) {
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [requester, setRequester] = useState<{ email: string; name: string } | null>(null);
  const [recipient, setRecipient] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ to: string; cc: string } | null>(null);
  const [tab, setTab] = useState<'email' | 'pdf'>('email');
  // Mount the PDF iframe only once its tab is first opened (avoids generating
  // the PDF up front), then keep it mounted so switching tabs doesn't reload it.
  const [pdfLoaded, setPdfLoaded] = useState(false);

  useEffect(() => {
    if (!open || !poId) return;
    setPreview(null); setError(''); setResult(null); setMessage('');
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
        setRecipient(previewJson.data.recipient || '');
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

  // Build the exact email the server will send, live as the message is typed.
  const email = useMemo(() => {
    if (!preview) return null;
    return buildPurchaseOrderEmail({
      poNumber: preview.po_number,
      vendorName: preview.vendor_name,
      shipTo: preview.ship_to,
      lines: preview.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        uom: l.uom,
        unitPrice: l.unitPrice,
      })),
      neededBy: preview.needed_by,
      notes: preview.notes,
      message: message.trim() || null,
      // Mirror the server: a blank requester name falls back to the company name.
      requesterName: requester?.name?.trim() || preview.company_name || null,
      requesterEmail: requester?.email || recipient || 'you@example.com',
    });
  }, [preview, message, requester, recipient]);

  const emailDoc = useMemo(() => {
    if (!email) return '';
    return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/></head><body style="margin:0;padding:16px;background:#fff;">${email.html}</body></html>`;
  }, [email]);

  if (!open || !poId) return null;

  const handleSend = async () => {
    setError('');
    if (!requester?.email) { setError('Could not determine your email — try reloading.'); return; }
    if (!recipient.trim()) { setError('Enter the vendor email to send to.'); return; }
    setSending(true);
    try {
      const res = await fetch(PO_EMAIL_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          po_id: poId,
          recipient_email: recipient.trim(),
          message: message.trim() || undefined,
          requester_email: requester.email,
          requester_name: requester.name || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || 'Failed to send');
      setResult({ to: json.data.to, cc: json.data.cc });
      onSent?.();
    } catch (err: any) {
      setError(err?.message || 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[92vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-white z-10">
          <h3 className="text-lg font-semibold flex items-center gap-2"><Mail className="h-5 w-5" /> Email PO to Vendor</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        {loading ? (
          <div className="p-10 flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading preview…
          </div>
        ) : result ? (
          <div className="p-6 space-y-4">
            <div className="flex items-start gap-2 p-3 bg-green-50 border border-green-200 rounded text-sm text-green-800">
              <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
              <div>
                <div className="font-medium">Purchase order emailed.</div>
                <div className="mt-1">To: {result.to}</div>
                <div>Copied to you: {result.cc}</div>
              </div>
            </div>
            <button onClick={onClose} className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm">Done</button>
          </div>
        ) : preview ? (
          <div className="p-6 space-y-4">
            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />{error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-1">To (vendor email) *</label>
              <input type="email" value={recipient} onChange={(e) => setRecipient(e.target.value)}
                placeholder="vendor@example.com"
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm" />
              {!preview.has_recipient && (
                <p className="text-xs text-amber-700 mt-1">{preview.vendor_name} has no email on file — enter one (and add it to the vendor later).</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Message <span className="text-muted-foreground font-normal">(optional — appears in the email below)</span></label>
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2}
                placeholder="Add a note to the vendor…"
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm" />
            </div>

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
                  <div><span className="text-muted-foreground">To:</span> {recipient || <span className="italic">vendor email</span>} · <span className="text-muted-foreground">Attachment:</span> PO-{preview.po_number}.pdf</div>
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

            <p className="text-xs text-muted-foreground">
              Sent with your name on it; replies go to {requester?.email ? <strong>{requester.email}</strong> : 'your email'}, and you&apos;re copied.
            </p>

            <div className="flex gap-3 pt-1">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50 text-sm">Cancel</button>
              <button type="button" onClick={handleSend} disabled={sending || !recipient.trim()}
                className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 text-sm flex items-center justify-center gap-1.5">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                {sending ? 'Sending…' : 'Send PO Email'}
              </button>
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
