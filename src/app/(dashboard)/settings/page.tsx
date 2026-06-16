'use client';

import { useState, useEffect } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { SupplyChainRPC } from '@/lib/rpc/supply-chain';
import { getStoredAccessToken, parseJwtPayload } from '@/lib/auth-token';

interface TenantSettings {
  id: string;
  tenant_id: string;
  po_number_format: string;
  po_number_prefix: string | null;
  cycle_count_number_format: string;
  cycle_count_number_prefix: string | null;
  auto_approve_enabled: boolean;
  auto_approve_limit: number | null;
  vendor_auto_approve_limits: Record<string, number> | null;
  reorder_mode: 'notify' | 'auto_draft' | 'auto_send';
  agent_permissions: Record<string, 'off' | 'ask' | 'auto'>;
  vendor_code_strategy: 'manual' | 'sequential' | 'hybrid' | 'import';
  vendor_code_required: boolean;
  vendor_code_case: 'upper' | 'lower' | 'preserve';
  vendor_code_min_length: number | null;
  vendor_code_max_length: number | null;
  vendor_code_prefix: string | null;
  vendor_code_suffix: string | null;
  vendor_code_allowed_chars: string | null;
  vendor_code_regex: string | null;
  vendor_code_user_editable: boolean;
  vendor_code_immutable_after_use: boolean;
  vendor_code_sequence_padding: number;
  updated_at: string;
}

interface Vendor {
  id: string;
  name: string;
  code: string | null;
}

type VendorCodeStrategy = TenantSettings['vendor_code_strategy'];
type VendorCodeCase = TenantSettings['vendor_code_case'];

type SettingsForm = {
  po_number_format: string;
  po_number_prefix: string;
  cycle_count_number_format: string;
  cycle_count_number_prefix: string;
  auto_approve_enabled: boolean;
  auto_approve_limit: string;
  reorder_mode: 'notify' | 'auto_draft' | 'auto_send';
  agent_permissions: Record<string, 'off' | 'ask' | 'auto'>;
  vendor_code_strategy: VendorCodeStrategy;
  vendor_code_required: boolean;
  vendor_code_case: VendorCodeCase;
  vendor_code_min_length: string;
  vendor_code_max_length: string;
  vendor_code_prefix: string;
  vendor_code_suffix: string;
  vendor_code_allowed_chars: string;
  vendor_code_regex: string;
  vendor_code_user_editable: boolean;
  vendor_code_immutable_after_use: boolean;
  vendor_code_sequence_padding: string;
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [reindexMsg, setReindexMsg] = useState('');
  const [reindexErr, setReindexErr] = useState('');
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorLimits, setVendorLimits] = useState<Record<string, string>>({});
  const [form, setForm] = useState<SettingsForm>({
    po_number_format: 'sequential-year',
    po_number_prefix: '',
    cycle_count_number_format: 'date-sequential',
    cycle_count_number_prefix: 'CC',
    auto_approve_enabled: true,
    auto_approve_limit: '',
    reorder_mode: 'auto_draft',
    agent_permissions: {
      stock_adjust: 'ask',
      stock_issue: 'ask',
      transfer: 'ask',
      reserve: 'ask',
      create_records: 'auto',
      purchase_orders: 'ask',
    },
    vendor_code_strategy: 'manual',
    vendor_code_required: false,
    vendor_code_case: 'preserve',
    vendor_code_min_length: '',
    vendor_code_max_length: '',
    vendor_code_prefix: '',
    vendor_code_suffix: '',
    vendor_code_allowed_chars: '',
    vendor_code_regex: '',
    vendor_code_user_editable: true,
    vendor_code_immutable_after_use: true,
    vendor_code_sequence_padding: '4',
  });

  useEffect(() => {
    fetchSettings();
    fetchVendors();
    checkAdminStatus();
  }, []);

  const checkAdminStatus = async () => {
    const token = getStoredAccessToken();
    const payload = token ? parseJwtPayload(token) : null;
    setIsAdmin(payload?.app_metadata?.role === 'admin');
  };

  const fetchVendors = async () => {
    try {
      const data = await SupplyChainRPC.getVendors();
      setVendors((data || []) as Vendor[]);
    } catch (error) {
      console.error('Error fetching vendors:', error);
    }
  };

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const data = await SupplyChainRPC.getTenantSettings();
      
      if (data) {
        setSettings(data);
        setForm({
          po_number_format: data.po_number_format || 'sequential-year',
          po_number_prefix: data.po_number_prefix || '',
          cycle_count_number_format: data.cycle_count_number_format || 'date-sequential',
          cycle_count_number_prefix: data.cycle_count_number_prefix || 'CC',
          auto_approve_enabled: data.auto_approve_enabled ?? true,
          auto_approve_limit: data.auto_approve_limit ? data.auto_approve_limit.toString() : '',
          reorder_mode: data.reorder_mode || 'auto_draft',
          agent_permissions: {
            stock_adjust: 'ask',
            stock_issue: 'ask',
            transfer: 'ask',
            reserve: 'ask',
            create_records: 'auto',
            purchase_orders: 'ask',
            ...(data.agent_permissions || {}),
          },
          vendor_code_strategy: data.vendor_code_strategy || 'manual',
          vendor_code_required: data.vendor_code_required || false,
          vendor_code_case: data.vendor_code_case || 'preserve',
          vendor_code_min_length: data.vendor_code_min_length ? data.vendor_code_min_length.toString() : '',
          vendor_code_max_length: data.vendor_code_max_length ? data.vendor_code_max_length.toString() : '',
          vendor_code_prefix: data.vendor_code_prefix || '',
          vendor_code_suffix: data.vendor_code_suffix || '',
          vendor_code_allowed_chars: data.vendor_code_allowed_chars || '',
          vendor_code_regex: data.vendor_code_regex || '',
          vendor_code_user_editable: data.vendor_code_user_editable ?? true,
          vendor_code_immutable_after_use: data.vendor_code_immutable_after_use ?? true,
          vendor_code_sequence_padding: data.vendor_code_sequence_padding?.toString() || '4',
        });
        
        // Load vendor-specific limits
        const limits: Record<string, string> = {};
        if (data.vendor_auto_approve_limits) {
          Object.entries(data.vendor_auto_approve_limits).forEach(([vendorId, limit]) => {
            limits[vendorId] = (limit as number).toString();
          });
        }
        setVendorLimits(limits);
      }
    } catch (error) {
      console.error('Error fetching settings:', error);
      setError('Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!isAdmin) {
      setError('You must be an admin to update settings');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      // Convert vendor limits to proper format
      const vendorLimitsObj: Record<string, number> = {};
      Object.entries(vendorLimits).forEach(([vendorId, limit]) => {
        if (limit && parseFloat(limit) > 0) {
          vendorLimitsObj[vendorId] = parseFloat(limit);
        }
      });

      const updated = await SupplyChainRPC.updateTenantSettings({
        po_number_format: form.po_number_format,
        po_number_prefix: form.po_number_prefix || null,
        cycle_count_number_format: form.cycle_count_number_format,
        cycle_count_number_prefix: form.cycle_count_number_prefix || null,
        auto_approve_enabled: form.auto_approve_enabled,
        auto_approve_limit: form.auto_approve_limit ? parseFloat(form.auto_approve_limit) : null,
        reorder_mode: form.reorder_mode,
        agent_permissions: form.agent_permissions,
        vendor_auto_approve_limits: vendorLimitsObj,
        vendor_code_strategy: form.vendor_code_strategy,
        vendor_code_required: form.vendor_code_required,
        vendor_code_case: form.vendor_code_case,
        vendor_code_min_length: form.vendor_code_min_length ? parseInt(form.vendor_code_min_length) : null,
        vendor_code_max_length: form.vendor_code_max_length ? parseInt(form.vendor_code_max_length) : null,
        vendor_code_prefix: form.vendor_code_prefix || null,
        vendor_code_suffix: form.vendor_code_suffix || null,
        vendor_code_allowed_chars: form.vendor_code_allowed_chars || null,
        vendor_code_regex: form.vendor_code_regex || null,
        vendor_code_user_editable: form.vendor_code_user_editable,
        vendor_code_immutable_after_use: form.vendor_code_immutable_after_use,
        vendor_code_sequence_padding: form.vendor_code_sequence_padding ? parseInt(form.vendor_code_sequence_padding) : 4,
      });

      setSuccess('Settings updated successfully!');
      setSettings(updated as TenantSettings);
      
      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      console.error('Error updating settings:', error);
      setError('Failed to update settings. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleReindex = async () => {
    if (!isAdmin || reindexing) return;
    setReindexing(true);
    setReindexErr('');
    setReindexMsg('');
    try {
      const res = await fetch('/api/ai/reindex', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-idempotency-key': `reindex-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setReindexErr(json?.error?.message || `Request failed (${res.status})`);
        return;
      }
      const d = json.data || json;
      const remaining = d.itemsRemaining
        ? ` (${d.itemsRemaining} still pending — run again)`
        : '';
      setReindexMsg(
        `Done — embedded ${d.itemsEmbedded ?? 0} item(s)${remaining}; linked ` +
          `${d.relationships?.supplied_by ?? 0} supplier and ${d.relationships?.stored_at ?? 0} location relationships.`
      );
    } catch (e: any) {
      setReindexErr(e?.message || 'Reindex failed. Please try again.');
    } finally {
      setReindexing(false);
    }
  };

  const formatExamples = {
    'sequential-year': '26-0001, 26-0002, 26-0003 (resets each year)',
    'sequential': '0001, 0002, 0003 (continuous)',
    'timestamp': 'PO-MKY42T62 (timestamp-based)',
  };

  const vendorCodeExamples = {
    manual: 'User-entered (validated by rules below)',
    sequential: '0001, 0002, 0003 (auto-generated)',
    hybrid: 'Auto-generated by default, user override allowed',
    import: 'Imported from CSV/accounting system',
  };

  const cycleCountFormatExamples = {
    'date-sequential': 'CC-20260129-00001 (date + sequential)',
    'sequential-year': 'CC-26-0001 (year + sequential)',
    'sequential': 'CC-0001 (continuous)',
  };

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500">Loading settings...</div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        title="Tenant Settings"
        description="Configure purchase order numbering and approval rules"
      />


      {!isAdmin && (
        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-yellow-800 font-medium">⚠️ Admin Access Required</p>
          <p className="text-yellow-700 text-sm mt-1">
            You are viewing settings in read-only mode. Only administrators can modify these settings.
          </p>
        </div>
      )}

      <div className="max-w-5xl">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Purchase Order Settings Panel */}
          <div className="bg-white rounded-lg border p-6 space-y-6">
            <h3 className="text-lg font-semibold pb-2 border-b">Purchase Order Settings</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">PO Number Format</label>
                <select
                  value={form.po_number_format}
                  onChange={(e) => setForm({ ...form, po_number_format: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  disabled={!isAdmin}
                >
                  <option value="sequential-year">Sequential with Year (26-0001)</option>
                  <option value="sequential">Sequential (0001)</option>
                  <option value="timestamp">Timestamp-based (PO-ABC123)</option>
                </select>
                <p className="text-sm text-gray-500 mt-1">
                  {formatExamples[form.po_number_format as keyof typeof formatExamples]}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  PO Number Prefix (Optional)
                </label>
                <input
                  type="text"
                  value={form.po_number_prefix}
                  onChange={(e) => setForm({ ...form, po_number_prefix: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="e.g., PO, ORDER"
                  maxLength={10}
                  disabled={!isAdmin}
                />
                <p className="text-sm text-gray-500 mt-1">
                  Optional prefix to add before the number (e.g., "PO" → PO-26-0001)
                </p>
              </div>
            </div>

            <div className="space-y-3 border-t pt-4">
              <div>
                <label className="block text-sm font-medium">When stock runs low</label>
                <p className="text-sm text-gray-500">
                  How Isabelle handles reorder needs found by the daily scan. Reorder alerts and
                  unusual-usage flags always appear in your notifications either way.
                </p>
              </div>
              {([
                {
                  value: 'notify',
                  title: 'Notify me only',
                  desc: 'Just flag what needs reordering. You (or Isabelle, on request) create the PO.',
                },
                {
                  value: 'auto_draft',
                  title: 'Auto-create draft POs',
                  desc: 'Build draft purchase orders automatically for you to review. Nothing is sent until you approve.',
                },
                {
                  value: 'auto_send',
                  title: 'Auto-create & send',
                  desc: 'Create and send POs to vendors automatically. (Currently creates drafts — auto-send to vendors is coming soon.)',
                },
              ] as const).map((opt) => (
                <label
                  key={opt.value}
                  className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors ${
                    form.reorder_mode === opt.value
                      ? 'border-primary bg-primary/5'
                      : 'border-gray-200 hover:border-gray-300'
                  } ${!isAdmin ? 'opacity-60 cursor-not-allowed' : ''}`}
                >
                  <input
                    type="radio"
                    name="reorder_mode"
                    value={opt.value}
                    checked={form.reorder_mode === opt.value}
                    onChange={() => setForm({ ...form, reorder_mode: opt.value })}
                    className="mt-1 h-4 w-4 text-primary focus:ring-2 focus:ring-primary"
                    disabled={!isAdmin}
                  />
                  <div>
                    <div className="text-sm font-medium">{opt.title}</div>
                    <div className="text-sm text-gray-500">{opt.desc}</div>
                  </div>
                </label>
              ))}
            </div>

            <div className="space-y-3 border-t pt-4">
              <div>
                <label className="block text-sm font-medium">What Isabelle can do</label>
                <p className="text-sm text-gray-500">
                  Control which actions the assistant can take. <strong>Off</strong> = she won&apos;t do
                  it, <strong>Ask first</strong> = she previews and waits for your OK, <strong>Auto</strong>
                  = she just does it.
                </p>
              </div>
              {([
                { key: 'stock_adjust', label: 'Adjust stock levels', desc: 'Set or correct on-hand quantities.' },
                { key: 'stock_issue', label: 'Issue stock', desc: 'Release stock to jobs, trucks, or people.' },
                { key: 'transfer', label: 'Transfer stock', desc: 'Move stock between locations.' },
                { key: 'reserve', label: 'Reservations', desc: 'Reserve stock and release reservations.' },
                { key: 'create_records', label: 'Create records', desc: 'Add vendors, items, locations, categories, assets.' },
                { key: 'purchase_orders', label: 'Purchase orders', desc: 'Create draft purchase orders.' },
              ] as const).map((cap) => (
                <div key={cap.key} className="flex items-center justify-between gap-4 rounded-lg border p-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{cap.label}</div>
                    <div className="text-sm text-gray-500">{cap.desc}</div>
                  </div>
                  <div className="flex flex-shrink-0 rounded-lg border p-0.5">
                    {(['off', 'ask', 'auto'] as const).map((lvl) => {
                      const active = (form.agent_permissions[cap.key] || 'ask') === lvl;
                      const labels: Record<string, string> = { off: 'Off', ask: 'Ask first', auto: 'Auto' };
                      return (
                        <button
                          key={lvl}
                          type="button"
                          disabled={!isAdmin}
                          onClick={() =>
                            setForm({
                              ...form,
                              agent_permissions: { ...form.agent_permissions, [cap.key]: lvl },
                            })
                          }
                          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                            active ? 'bg-primary text-primary-foreground' : 'text-gray-600 hover:bg-gray-100'
                          } ${!isAdmin ? 'cursor-not-allowed opacity-60' : ''}`}
                        >
                          {labels[lvl]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-4 border-t pt-4">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="auto_approve"
                  checked={form.auto_approve_enabled}
                  onChange={(e) => setForm({ ...form, auto_approve_enabled: e.target.checked })}
                  className="w-4 h-4 text-primary focus:ring-2 focus:ring-primary rounded"
                  disabled={!isAdmin}
                />
                <label htmlFor="auto_approve" className="ml-2 text-sm font-medium">
                  Enable automatic approval for POs under a certain amount
                </label>
              </div>

              {form.auto_approve_enabled && (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Global Auto-Approve Limit ($)
                    </label>
                    <input
                      type="number"
                      value={form.auto_approve_limit}
                      onChange={(e) => setForm({ ...form, auto_approve_limit: e.target.value })}
                      className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                      placeholder="e.g., 1000.00 (optional if using vendor-specific)"
                      step="0.01"
                      min="0"
                      disabled={!isAdmin}
                    />
                    <p className="text-sm text-gray-500 mt-1">
                      Default limit for all vendors. Leave blank if only using vendor-specific limits.
                    </p>
                  </div>

                  <div className="border-t pt-4">
                    <label className="block text-sm font-medium mb-2">
                      Vendor-Specific Auto-Approve Limits (Optional)
                    </label>
                    <p className="text-sm text-gray-600 mb-3">
                      Set different approval limits for specific vendors. These override the global limit.
                    </p>

                    {vendors.length === 0 ? (
                      <p className="text-sm text-gray-500 italic">No vendors configured yet.</p>
                    ) : (
                      <div className="space-y-2 max-h-64 overflow-y-auto">
                        {vendors.map((vendor) => (
                          <div key={vendor.id} className="flex items-center gap-3 p-2 bg-gray-50 rounded">
                            <span className="flex-1 text-sm font-medium">
                              {vendor.name} ({vendor.code || 'NO-CODE'})
                            </span>
                            <input
                              type="number"
                              value={vendorLimits[vendor.id] || ''}
                              onChange={(e) => setVendorLimits({ ...vendorLimits, [vendor.id]: e.target.value })}
                              className="w-32 px-2 py-1 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                              placeholder="$ limit"
                              step="0.01"
                              min="0"
                              disabled={!isAdmin}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Vendor Code Settings Panel */}
          <div className="bg-white rounded-lg border p-6 space-y-4">
            <h3 className="text-lg font-semibold pb-2 border-b">Vendor Code Settings</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Strategy</label>
                <select
                  value={form.vendor_code_strategy}
                  onChange={(e) => setForm({ ...form, vendor_code_strategy: e.target.value as 'manual' | 'sequential' | 'hybrid' | 'import' })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  disabled={!isAdmin}
                >
                  <option value="manual">Manual</option>
                  <option value="sequential">Sequential (auto)</option>
                  <option value="hybrid">Hybrid (auto + override)</option>
                  <option value="import">Import-driven</option>
                </select>
                <p className="text-sm text-gray-500 mt-1">
                  {vendorCodeExamples[form.vendor_code_strategy as keyof typeof vendorCodeExamples]}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="vendor_code_required"
                    checked={form.vendor_code_required}
                    onChange={(e) => setForm({ ...form, vendor_code_required: e.target.checked })}
                    className="w-4 h-4 text-primary focus:ring-2 focus:ring-primary rounded"
                    disabled={!isAdmin}
                  />
                  <label htmlFor="vendor_code_required" className="ml-2 text-sm font-medium">
                    Require vendor code
                  </label>
                </div>
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="vendor_code_editable"
                    checked={form.vendor_code_user_editable}
                    onChange={(e) => setForm({ ...form, vendor_code_user_editable: e.target.checked })}
                    className="w-4 h-4 text-primary focus:ring-2 focus:ring-primary rounded"
                    disabled={!isAdmin}
                  />
                  <label htmlFor="vendor_code_editable" className="ml-2 text-sm font-medium">
                    Allow edits
                  </label>
                </div>
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="vendor_code_immutable"
                  checked={form.vendor_code_immutable_after_use}
                  onChange={(e) => setForm({ ...form, vendor_code_immutable_after_use: e.target.checked })}
                  className="w-4 h-4 text-primary focus:ring-2 focus:ring-primary rounded"
                  disabled={!isAdmin}
                />
                <label htmlFor="vendor_code_immutable" className="ml-2 text-sm font-medium">
                  Lock vendor code after purchase activity
                </label>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Case Normalization</label>
                  <select
                    value={form.vendor_code_case}
                    onChange={(e) => setForm({ ...form, vendor_code_case: e.target.value as 'upper' | 'lower' | 'preserve' })}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    disabled={!isAdmin}
                  >
                    <option value="preserve">Preserve</option>
                    <option value="upper">Uppercase</option>
                    <option value="lower">Lowercase</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Sequence Padding</label>
                  <input
                    type="number"
                    value={form.vendor_code_sequence_padding}
                    onChange={(e) => setForm({ ...form, vendor_code_sequence_padding: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    min="1"
                    max="12"
                    disabled={!isAdmin}
                  />
                  <p className="text-sm text-gray-500 mt-1">
                    Applies to sequential or hybrid strategies.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Prefix</label>
                  <input
                    type="text"
                    value={form.vendor_code_prefix}
                    onChange={(e) => setForm({ ...form, vendor_code_prefix: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="e.g., VND-"
                    disabled={!isAdmin}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Suffix</label>
                  <input
                    type="text"
                    value={form.vendor_code_suffix}
                    onChange={(e) => setForm({ ...form, vendor_code_suffix: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="e.g., -US"
                    disabled={!isAdmin}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Min Length</label>
                  <input
                    type="number"
                    value={form.vendor_code_min_length}
                    onChange={(e) => setForm({ ...form, vendor_code_min_length: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    min="1"
                    disabled={!isAdmin}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Max Length</label>
                  <input
                    type="number"
                    value={form.vendor_code_max_length}
                    onChange={(e) => setForm({ ...form, vendor_code_max_length: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    min="1"
                    disabled={!isAdmin}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Allowed Characters</label>
                <input
                  type="text"
                  value={form.vendor_code_allowed_chars}
                  onChange={(e) => setForm({ ...form, vendor_code_allowed_chars: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono"
                  placeholder="A-Z0-9_-"
                  disabled={!isAdmin}
                />
                <p className="text-sm text-gray-500 mt-1">
                  Regex character class, e.g. A-Z0-9_-.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Regex Validation (Optional)</label>
                <input
                  type="text"
                  value={form.vendor_code_regex}
                  onChange={(e) => setForm({ ...form, vendor_code_regex: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono"
                  placeholder="^VND-[A-Z0-9]{4}$"
                  disabled={!isAdmin}
                />
              </div>
            </div>
          </div>

          {/* Cycle Count Settings Panel */}
          <div className="bg-white rounded-lg border p-6 space-y-4">
            <h3 className="text-lg font-semibold pb-2 border-b">Cycle Count Settings</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Number Format</label>
                <select
                  value={form.cycle_count_number_format}
                  onChange={(e) => setForm({ ...form, cycle_count_number_format: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  disabled={!isAdmin}
                >
                  <option value="date-sequential">Date + Sequential (CC-20260129-00001)</option>
                  <option value="sequential-year">Sequential with Year (CC-26-0001)</option>
                  <option value="sequential">Sequential (CC-0001)</option>
                </select>
                <p className="text-sm text-gray-500 mt-1">
                  {cycleCountFormatExamples[form.cycle_count_number_format as keyof typeof cycleCountFormatExamples]}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Number Prefix (Optional)
                </label>
                <input
                  type="text"
                  value={form.cycle_count_number_prefix}
                  onChange={(e) => setForm({ ...form, cycle_count_number_prefix: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="e.g., CC, COUNT"
                  maxLength={10}
                  disabled={!isAdmin}
                />
                <p className="text-sm text-gray-500 mt-1">
                  Optional prefix to add before the number (e.g., "CC" → CC-20260129-00001)
                </p>
              </div>
            </div>
          </div>

          </div>

          {/* Error/Success Messages */}
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {success && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-md">
              <p className="text-sm text-green-800">{success}</p>
            </div>
          )}

          {/* Submit Button */}
          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              disabled={!isAdmin || saving}
              className="px-6 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
            
            {settings?.updated_at && (
              <span className="text-sm text-gray-500 self-center">
                Last updated: {new Date(settings.updated_at).toLocaleString()}
              </span>
            )}
          </div>
        </form>

        {/* AI Assistant Panel */}
        <div className="mt-6 bg-white rounded-lg border p-6">
          <h3 className="text-lg font-semibold pb-2 border-b flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-teal-600" />
            AI Assistant (Isabelle)
          </h3>
          <p className="text-sm text-gray-600 mt-3">
            Rebuild Isabelle&apos;s search knowledge: generate item embeddings (powers semantic
            search) and refresh the ontology of items, vendors, locations, and their
            supplier/storage relationships. Run this after adding or importing items so
            &quot;find me something like…&quot; and substitute lookups work.
          </p>

          <div className="flex items-center gap-3 mt-4">
            <button
              type="button"
              onClick={handleReindex}
              disabled={!isAdmin || reindexing}
              className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-md hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {reindexing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Reindexing…
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Reindex AI Knowledge
                </>
              )}
            </button>
            {!isAdmin && (
              <span className="text-sm text-gray-500">Admin access required.</span>
            )}
          </div>

          {reindexMsg && (
            <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-md">
              <p className="text-sm text-green-800">{reindexMsg}</p>
            </div>
          )}
          {reindexErr && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-800">{reindexErr}</p>
            </div>
          )}
        </div>

        {/* Info Box */}
        <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h4 className="font-medium text-blue-900 mb-2">📋 How it works</h4>
          <ul className="text-sm text-blue-800 space-y-1">
            <li>• <strong>PO Numbering:</strong> New purchase orders will use your selected format automatically</li>
            <li>• <strong>Auto-Approval:</strong> When enabled, POs below the limit skip the approval step and go straight to "Approved" status</li>
            <li>• <strong>Tenant-Specific:</strong> These settings apply only to your organization</li>
            <li>• <strong>Admin Only:</strong> Only users with admin role can modify these settings</li>
          </ul>
        </div>
      </div>

    </AppShell>
  );
}
