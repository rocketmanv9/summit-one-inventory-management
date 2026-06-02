'use client';

/**
 * Review & email a purchase order to its vendor.
 *
 * Loads a server-composed preview (recipient, ship-to, line items) so the user
 * reviews exactly what will be sent, can edit the recipient + add a message,
 * then sends from their own address (CC'd back to them).
 */

import { useState, useEffect } from 'react';
import { Loader2, Mail, CheckCircle2, AlertCircle } from 'lucide-react';

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

function money(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function SendPOEmailModal({ open, poId, onClose, onSent }: SendPOEmailModalProps) {
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [requester, setRequester] = useState<{ email: string; name: string } | null>(null);
  const [recipient, setRecipient] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ to: string; cc: string } | null>(null);

  useEffect(() => {
    if (!open || !poId) return;
    setPreview(null); setError(''); setResult(null); setMessage('');
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
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-white">
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

            {/* Read-only preview of what will be sent */}
            <div className="border rounded-lg bg-gray-50 p-3 space-y-2 text-sm">
              <div className="font-medium">{preview.subject}</div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-muted-foreground border-b">
                    <th className="py-1 pr-2">Item</th><th className="py-1 pr-2">Qty</th><th className="py-1 pr-2">Unit</th><th className="py-1">Total</th>
                  </tr></thead>
                  <tbody>
                    {preview.lines.map((l, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-1 pr-2">{l.description}</td>
                        <td className="py-1 pr-2">{l.quantity}{l.uom ? ` ${l.uom}` : ''}</td>
                        <td className="py-1 pr-2">{l.unitPrice != null ? money(l.unitPrice) : '—'}</td>
                        <td className="py-1">{l.unitPrice != null ? money(l.unitPrice * l.quantity) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.ship_to && <div><span className="text-muted-foreground">Deliver to:</span> <span className="font-medium">{preview.ship_to}</span></div>}
              {preview.needed_by && <div><span className="text-muted-foreground">Needed by:</span> {new Date(preview.needed_by).toLocaleDateString()}</div>}
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Message <span className="text-muted-foreground font-normal">(optional)</span></label>
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3}
                placeholder="Add a note to the vendor…"
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm" />
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
