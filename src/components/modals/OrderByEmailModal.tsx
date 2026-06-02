'use client';

/**
 * Order-by-Email Modal
 *
 * Pick a vendor + item + quantity, write a custom message, and email the vendor
 * an order request. The email is sent from the signed-in user's address and
 * CC'd back to them for transparency.
 */

import { useState, useEffect } from 'react';
import { SupplyChainRPC } from '@/lib/rpc/supply-chain';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { useUOMLabelMap } from '@/hooks/useGVTerms';
import { Loader2, Mail, CheckCircle2, AlertCircle } from 'lucide-react';

interface OrderByEmailModalProps {
  open: boolean;
  onClose: () => void;
  presetVendorId?: string;
}

export function OrderByEmailModal({ open, onClose, presetVendorId }: OrderByEmailModalProps) {
  const uomLabels = useUOMLabelMap();

  const [vendors, setVendors] = useState<Array<{ id: string; name: string }>>([]);
  const [items, setItems] = useState<Array<{ id: string; name: string; sku: string; uom_term_id: string | null }>>([]);
  const [requester, setRequester] = useState<{ email: string; name: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    vendor_id: '',
    mode: 'catalog' as 'catalog' | 'freetext',
    catalog_item_id: '',
    item_description: '',
    quantity: '',
    unit_price: '',
    needed_by: '',
    message: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ to: string; cc: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm({
      vendor_id: presetVendorId || '', mode: 'catalog', catalog_item_id: '',
      item_description: '', quantity: '', unit_price: '', needed_by: '', message: '',
    });
    setError('');
    setResult(null);

    const load = async () => {
      setLoading(true);
      try {
        const [vendorsData, itemsData, sessionRes] = await Promise.all([
          SupplyChainRPC.getVendors(),
          InventoryRPC.getCatalogItems({ active: true }),
          fetch('/api/auth/session').then((r) => (r.ok ? r.json() : null)).catch(() => null),
        ]);
        setVendors((vendorsData || []).map((v: any) => ({ id: v.id, name: v.name })));
        setItems((itemsData || []).map((i: any) => ({ id: i.id, name: i.name, sku: i.sku, uom_term_id: i.uom_term_id ?? null })));
        if (sessionRes?.email) setRequester({ email: sessionRes.email, name: sessionRes.name || '' });
      } catch {
        setError('Failed to load vendors and items. Please try again.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [open, presetVendorId]);

  if (!open) return null;

  const selectedItem = items.find((i) => i.id === form.catalog_item_id);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!requester?.email) {
      setError('Could not determine your email address — try reloading the page.');
      return;
    }
    const qty = parseFloat(form.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('Enter a valid quantity.');
      return;
    }

    setSaving(true);
    try {
      const uom = form.mode === 'catalog' && selectedItem?.uom_term_id
        ? uomLabels[selectedItem.uom_term_id]
        : undefined;

      const res = await fetch('/api/inventory/vendors/order-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          vendor_id: form.vendor_id,
          catalog_item_id: form.mode === 'catalog' ? form.catalog_item_id || undefined : undefined,
          item_description: form.mode === 'freetext' ? form.item_description.trim() || undefined : undefined,
          quantity: qty,
          uom,
          unit_price: form.unit_price ? parseFloat(form.unit_price) : undefined,
          needed_by: form.needed_by || undefined,
          message: form.message.trim() || undefined,
          requester_email: requester.email,
          requester_name: requester.name || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || 'Failed to send order email');

      setResult({ to: json.data.to, cc: json.data.cc });
    } catch (err: any) {
      setError(err?.message || 'Failed to send order email');
    } finally {
      setSaving(false);
    }
  };

  const canSubmit =
    !!form.vendor_id &&
    !!form.quantity &&
    (form.mode === 'catalog' ? !!form.catalog_item_id : !!form.item_description.trim());

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-white">
          <h3 className="text-lg font-semibold flex items-center gap-2"><Mail className="h-5 w-5" /> Email an Order</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        {loading ? (
          <div className="p-10 flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading…
          </div>
        ) : result ? (
          <div className="p-6 space-y-4">
            <div className="flex items-start gap-2 p-3 bg-green-50 border border-green-200 rounded text-sm text-green-800">
              <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
              <div>
                <div className="font-medium">Order email sent.</div>
                <div className="mt-1">To: {result.to}</div>
                <div>Copied to you: {result.cc}</div>
              </div>
            </div>
            <button onClick={onClose} className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm">Done</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />{error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-1">Vendor *</label>
              <select value={form.vendor_id} onChange={(e) => setForm({ ...form, vendor_id: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm" required>
                <option value="">Select a vendor…</option>
                {vendors.map((v) => (<option key={v.id} value={v.id}>{v.name}</option>))}
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium">Item *</label>
                <button type="button"
                  onClick={() => setForm({ ...form, mode: form.mode === 'catalog' ? 'freetext' : 'catalog', catalog_item_id: '', item_description: '' })}
                  className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                  {form.mode === 'catalog' ? 'Enter free text' : 'Pick from catalog'}
                </button>
              </div>
              {form.mode === 'catalog' ? (
                <select value={form.catalog_item_id} onChange={(e) => setForm({ ...form, catalog_item_id: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm">
                  <option value="">Select an item…</option>
                  {items.map((i) => (<option key={i.id} value={i.id}>{i.name} ({i.sku})</option>))}
                </select>
              ) : (
                <input type="text" value={form.item_description} onChange={(e) => setForm({ ...form, item_description: e.target.value })}
                  placeholder="e.g. 5 gallon safety gas can"
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm" />
              )}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">Quantity *</label>
                <input type="number" min="0" step="0.01" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm" required />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Unit price</label>
                <input type="number" min="0" step="0.01" value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: e.target.value })}
                  placeholder="(optional)"
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Needed by</label>
                <input type="date" value={form.needed_by} onChange={(e) => setForm({ ...form, needed_by: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Message</label>
              <textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} rows={4}
                placeholder="Add a custom note to the vendor (delivery details, questions, etc.)"
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm" />
            </div>

            <p className="text-xs text-muted-foreground">
              Sends from {requester?.email ? <strong>{requester.email}</strong> : 'your account'} and copies you for your records.
            </p>

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50 text-sm">Cancel</button>
              <button type="submit" disabled={saving || !canSubmit}
                className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 text-sm flex items-center justify-center gap-1.5">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                {saving ? 'Sending…' : 'Send Order Email'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
