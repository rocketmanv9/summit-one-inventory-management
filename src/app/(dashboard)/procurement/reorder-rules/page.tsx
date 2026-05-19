'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { Loader2, Plus, Pencil, Trash2, Check, X } from 'lucide-react';

export default function ReorderRulesPage() {
  const [loading, setLoading] = useState(true);
  const [rules, setRules] = useState<any[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({
    catalog_item_id: '',
    item_name: '',
    reorder_point: 0,
    reorder_qty: 0,
    max_stock: '',
    preferred_provider_id: '',
    external_product_id: '',
    unit_cost: '',
    auto_reorder: false,
  });

  const loadData = async () => {
    setLoading(true);
    const [rulesRes, providersRes] = await Promise.all([
      fetch('/api/procurement/reorder-rules?active=false').then(r => r.json()).catch(() => ({ data: [] })),
      fetch('/api/procurement/providers').then(r => r.json()).catch(() => ({ data: [] })),
    ]);
    setRules(rulesRes?.data || []);
    setProviders(providersRes?.data || []);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const resetForm = () => {
    setForm({ catalog_item_id: '', item_name: '', reorder_point: 0, reorder_qty: 0, max_stock: '', preferred_provider_id: '', external_product_id: '', unit_cost: '', auto_reorder: false });
    setShowForm(false);
    setEditingId(null);
  };

  const startEdit = (rule: any) => {
    setForm({
      catalog_item_id: rule.catalog_item_id,
      item_name: rule.item_name,
      reorder_point: rule.reorder_point,
      reorder_qty: rule.reorder_qty,
      max_stock: rule.max_stock?.toString() || '',
      preferred_provider_id: rule.preferred_provider_id || '',
      external_product_id: rule.external_product_id || '',
      unit_cost: rule.unit_cost?.toString() || '',
      auto_reorder: rule.auto_reorder,
    });
    setEditingId(rule.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      const payload: any = {
        catalog_item_id: form.catalog_item_id,
        item_name: form.item_name,
        reorder_point: form.reorder_point,
        reorder_qty: form.reorder_qty,
      };
      if (form.max_stock) payload.max_stock = parseInt(form.max_stock, 10);
      if (form.preferred_provider_id) payload.preferred_provider_id = form.preferred_provider_id;
      if (form.external_product_id) payload.external_product_id = form.external_product_id;
      if (form.unit_cost) payload.unit_cost = parseFloat(form.unit_cost);
      payload.auto_reorder = form.auto_reorder;

      const url = editingId
        ? `/api/procurement/reorder-rules/${editingId}`
        : '/api/procurement/reorder-rules';
      const method = editingId ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setMessage(editingId ? 'Rule updated' : 'Rule created');
        resetForm();
        await loadData();
      } else {
        const json = await res.json();
        setMessage(json?.error?.message || 'Failed to save rule');
      }
    } catch {
      setMessage('Failed to save rule');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (ruleId: string) => {
    try {
      await fetch(`/api/procurement/reorder-rules/${ruleId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({}),
      });
      await loadData();
    } catch { /* empty */ }
  };

  if (loading) {
    return <AppShell><div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div></AppShell>;
  }

  return (
    <AppShell>
      <PageHeader title="Reorder Rules" description="Configure automatic reorder thresholds for inventory items" backHref="/procurement" />

      {message && <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-800">{message}</div>}

      {/* Add/Edit Form */}
      {showForm ? (
        <div className="bg-white rounded-lg border p-6 mb-6">
          <h3 className="font-semibold mb-4">{editingId ? 'Edit Rule' : 'New Reorder Rule'}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {!editingId && (
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Catalog Item ID</label>
                <input type="text" value={form.catalog_item_id} onChange={e => setForm({ ...form, catalog_item_id: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md text-sm" placeholder="UUID of inventory item" />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Item Name</label>
              <input type="text" value={form.item_name} onChange={e => setForm({ ...form, item_name: e.target.value })}
                className="w-full px-3 py-2 border rounded-md text-sm" placeholder="e.g. Safety Vests" />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Reorder Point</label>
              <input type="number" value={form.reorder_point} onChange={e => setForm({ ...form, reorder_point: parseInt(e.target.value) || 0 })}
                className="w-full px-3 py-2 border rounded-md text-sm" min={0} />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Reorder Quantity</label>
              <input type="number" value={form.reorder_qty} onChange={e => setForm({ ...form, reorder_qty: parseInt(e.target.value) || 0 })}
                className="w-full px-3 py-2 border rounded-md text-sm" min={1} />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Max Stock (optional)</label>
              <input type="number" value={form.max_stock} onChange={e => setForm({ ...form, max_stock: e.target.value })}
                className="w-full px-3 py-2 border rounded-md text-sm" placeholder="Upper bound" />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Preferred Provider</label>
              <select value={form.preferred_provider_id} onChange={e => setForm({ ...form, preferred_provider_id: e.target.value })}
                className="w-full px-3 py-2 border rounded-md text-sm bg-white">
                <option value="">None</option>
                {providers.map((p: any) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">External SKU (optional)</label>
              <input type="text" value={form.external_product_id} onChange={e => setForm({ ...form, external_product_id: e.target.value })}
                className="w-full px-3 py-2 border rounded-md text-sm" placeholder="Vendor product ID" />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Unit Cost (optional)</label>
              <input type="number" step="0.01" value={form.unit_cost} onChange={e => setForm({ ...form, unit_cost: e.target.value })}
                className="w-full px-3 py-2 border rounded-md text-sm" placeholder="0.00" />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <input type="checkbox" id="auto_reorder" checked={form.auto_reorder} onChange={e => setForm({ ...form, auto_reorder: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300" />
              <label htmlFor="auto_reorder" className="text-sm font-medium">Auto-create requests when low</label>
            </div>
          </div>
          <div className="flex gap-2 mt-6">
            <button onClick={handleSave} disabled={saving || !form.item_name || !form.reorder_qty}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 text-sm font-medium flex items-center gap-1.5">
              <Check className="h-4 w-4" /> {saving ? 'Saving...' : 'Save'}
            </button>
            <button onClick={resetForm} className="px-4 py-2 border rounded-md hover:bg-gray-50 text-sm flex items-center gap-1.5">
              <X className="h-4 w-4" /> Cancel
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowForm(true)} className="mb-6 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm font-medium flex items-center gap-1.5">
          <Plus className="h-4 w-4" /> Add Reorder Rule
        </button>
      )}

      {/* Rules Table */}
      <div className="bg-white rounded-lg border">
        <div className="p-6">
          {rules.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No reorder rules configured yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left">
                <th className="pb-2 font-medium text-muted-foreground">Item</th>
                <th className="pb-2 font-medium text-muted-foreground text-right">Reorder Point</th>
                <th className="pb-2 font-medium text-muted-foreground text-right">Reorder Qty</th>
                <th className="pb-2 font-medium text-muted-foreground text-center">Auto</th>
                <th className="pb-2 font-medium text-muted-foreground">Vendor SKU</th>
                <th className="pb-2 font-medium text-muted-foreground text-center">Active</th>
                <th className="pb-2 font-medium text-muted-foreground text-right"></th>
              </tr></thead>
              <tbody>
                {rules.map((rule: any) => (
                  <tr key={rule.id} className={`border-b last:border-0 ${!rule.is_active ? 'opacity-50' : ''}`}>
                    <td className="py-2.5 font-medium">{rule.item_name}</td>
                    <td className="py-2.5 text-right">{rule.reorder_point}</td>
                    <td className="py-2.5 text-right">{rule.reorder_qty}</td>
                    <td className="py-2.5 text-center">{rule.auto_reorder ? <Check className="h-4 w-4 text-green-600 inline" /> : <span className="text-muted-foreground">-</span>}</td>
                    <td className="py-2.5 font-mono text-xs text-muted-foreground">{rule.external_product_id || '-'}</td>
                    <td className="py-2.5 text-center">{rule.is_active ? <span className="text-green-600 text-xs">Active</span> : <span className="text-red-600 text-xs">Inactive</span>}</td>
                    <td className="py-2.5 text-right">
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => startEdit(rule)} className="p-1 hover:bg-gray-100 rounded" title="Edit">
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                        <button onClick={() => handleDelete(rule.id)} className="p-1 hover:bg-red-50 rounded" title="Deactivate">
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-600" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </AppShell>
  );
}
