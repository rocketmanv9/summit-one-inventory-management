'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/FilterBar';
import { StatusChip } from '@/components/ui/StatusChip';
import { SupplyChainRPC } from '@/lib/rpc/supply-chain';
import type { Database } from 'types/supabase';

type Vendor = Database['supply_chain']['Tables']['vendors']['Row'];

type VendorCodeSettings = {
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
  vendor_code_sequence_padding: number | null;
  vendor_code_next_seq: number | null;
};

export default function VendorsPage() {
  const router = useRouter();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);

  useEffect(() => {
    fetchVendors();
  }, []);

  const fetchVendors = async () => {
    setLoading(true);
    try {
      const data = await SupplyChainRPC.getVendors();
      setVendors(data || []);
    } catch (error) {
      console.error('Error fetching vendors:', error);
    } finally {
      setLoading(false);
    }
  };

  const columns = [
    {
      key: 'name',
      header: 'Vendor',
      sortable: true,
      render: (row: Vendor) => (
        <div>
          <div className="font-medium">{row.name}</div>
          {row.code && <div className="text-xs text-muted-foreground font-mono">{row.code}</div>}
        </div>
      ),
    },
    {
      key: 'contact',
      header: 'Contact',
      render: (row: Vendor) => (
        <div>
          {row.contact_name && <div>{row.contact_name}</div>}
          {row.contact_email && <div className="text-xs text-muted-foreground">{row.contact_email}</div>}
        </div>
      ),
    },
    {
      key: 'contact_phone',
      header: 'Phone',
      render: (row: Vendor) => row.contact_phone || '-',
    },
    {
      key: 'payment_terms',
      header: 'Payment Terms',
      render: (row: Vendor) => row.payment_terms || '-',
    },
    {
      key: 'lead_time_days',
      header: 'Lead Time',
      className: 'text-right',
      render: (row: Vendor) => row.lead_time_days ? `${row.lead_time_days} days` : '-',
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: Vendor) => (
        <StatusChip status={row.active ? 'active' : 'inactive'} />
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (row: Vendor) => (
        <div className="flex gap-2">
          <button
            onClick={() => router.push(`/inventory/vendors/${row.id}/items`)}
            className="text-sm text-green-600 hover:text-green-700"
          >
            Items
          </button>
          <button
            onClick={() => setEditingVendor(row)}
            className="text-sm text-blue-600 hover:text-blue-700"
          >
            Edit
          </button>
          <button
            onClick={() => handleDelete(row)}
            className="text-sm text-red-600 hover:text-red-700"
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  const handleDelete = async (vendor: Vendor) => {
    if (!confirm(`Delete vendor "${vendor.name}"?`)) {
      return;
    }

    try {
      if (!vendor.last_event_id) {
        throw new Error('Missing last_event_id for this vendor. Please refresh and try again.');
      }

      await SupplyChainRPC.deleteVendor(vendor.id, vendor.last_event_id);

      fetchVendors();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const filterConfig = [
    {
      key: 'search',
      label: 'Search',
      type: 'search' as const,
      placeholder: 'Vendor name...',
    },
  ];

  const filteredVendors = vendors.filter((vendor) => {
    if (filters.search) {
      const term = filters.search.toLowerCase();
      const nameMatch = vendor.name.toLowerCase().includes(term);
      const codeMatch = (vendor.code || '').toLowerCase().includes(term);
      return nameMatch || codeMatch;
    }
    return true;
  });

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Vendors"
          description="Manage your suppliers and vendors. Example: Maintain vendor records for 'Acme Asphalt Supply', 'Riverside Ready-Mix', or 'Steel Rebar Distributors' with contact info, pricing, and delivery locations for easy PO creation."
          actions={
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              + Add Vendor
            </button>
          }
        />

        <FilterBar
          filters={filterConfig}
          values={filters}
          onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
          onClear={() => setFilters({})}
        />

        <DataTable
          data={filteredVendors}
          columns={columns}
          loading={loading}
          emptyMessage="No vendors found"
          rowKey={(row) => row.id}
        />

        {showCreateModal && (
          <VendorModal
            onClose={() => setShowCreateModal(false)}
            onSaved={() => {
              setShowCreateModal(false);
              fetchVendors();
            }}
          />
        )}

        {editingVendor && (
          <VendorModal
            vendor={editingVendor}
            onClose={() => setEditingVendor(null)}
            onSaved={() => {
              setEditingVendor(null);
              fetchVendors();
            }}
          />
        )}
      </div>
    </AppShell>
  );
}

function VendorModal({ 
  vendor, 
  onClose, 
  onSaved 
}: { 
  vendor?: Vendor;
  onClose: () => void; 
  onSaved: () => void;
}) {
  const isEdit = !!vendor;
  const [codeSettings, setCodeSettings] = useState<VendorCodeSettings | null>(null);
  const [form, setForm] = useState({
    name: vendor?.name || '',
    code: vendor?.code || '',
    contact_name: vendor?.contact_name || '',
    contact_email: vendor?.contact_email || '',
    contact_phone: vendor?.contact_phone || '',
    payment_terms: vendor?.payment_terms || 'NET30',
    lead_time_days: vendor?.lead_time_days?.toString() || '',
    notes: vendor?.notes || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const settings = await SupplyChainRPC.getTenantSettings();
        setCodeSettings({
          vendor_code_strategy: settings.vendor_code_strategy,
          vendor_code_required: settings.vendor_code_required,
          vendor_code_case: settings.vendor_code_case,
          vendor_code_min_length: settings.vendor_code_min_length,
          vendor_code_max_length: settings.vendor_code_max_length,
          vendor_code_prefix: settings.vendor_code_prefix,
          vendor_code_suffix: settings.vendor_code_suffix,
          vendor_code_allowed_chars: settings.vendor_code_allowed_chars,
          vendor_code_regex: settings.vendor_code_regex,
          vendor_code_user_editable: settings.vendor_code_user_editable,
          vendor_code_immutable_after_use: settings.vendor_code_immutable_after_use,
          vendor_code_sequence_padding: settings.vendor_code_sequence_padding,
          vendor_code_next_seq: settings.vendor_code_next_seq,
        });
      } catch (err) {
        console.error('Error fetching vendor code settings:', err);
      }
    };

    fetchSettings();
  }, []);

  const vendorCodeHelp = useMemo(() => {
    if (!codeSettings) return null;
    if (codeSettings.vendor_code_strategy === 'sequential') {
      return 'Leave blank to auto-generate a sequential vendor code.';
    }
    if (codeSettings.vendor_code_strategy === 'hybrid') {
      return 'Leave blank to auto-generate or enter a custom code.';
    }
    if (codeSettings.vendor_code_strategy === 'import') {
      return 'Codes are expected from imports; use this only when needed.';
    }
    return 'Enter a vendor code that matches your tenant rules.';
  }, [codeSettings]);

  const vendorCodeRules = useMemo(() => {
    if (!codeSettings) return [] as string[];

    const rules: string[] = [];
    if (codeSettings.vendor_code_prefix) {
      rules.push(`Prefix: ${codeSettings.vendor_code_prefix}`);
    }
    if (codeSettings.vendor_code_suffix) {
      rules.push(`Suffix: ${codeSettings.vendor_code_suffix}`);
    }
    if (codeSettings.vendor_code_min_length || codeSettings.vendor_code_max_length) {
      rules.push(
        `Length: ${codeSettings.vendor_code_min_length ?? '1'}-${codeSettings.vendor_code_max_length ?? '∞'}`
      );
    }
    if (codeSettings.vendor_code_allowed_chars) {
      rules.push(`Allowed: ${codeSettings.vendor_code_allowed_chars}`);
    }
    if (codeSettings.vendor_code_regex) {
      rules.push(`Regex: ${codeSettings.vendor_code_regex}`);
    }
    if (codeSettings.vendor_code_case !== 'preserve') {
      rules.push(`Case: ${codeSettings.vendor_code_case}`);
    }

    return rules;
  }, [codeSettings]);

  const normalizeVendorCode = (value: string) => {
    if (!codeSettings) return value;
    if (codeSettings.vendor_code_case === 'upper') {
      return value.toUpperCase();
    }
    if (codeSettings.vendor_code_case === 'lower') {
      return value.toLowerCase();
    }
    return value;
  };

  const nextSequentialCode = useMemo(() => {
    if (!codeSettings) return null;
    if (codeSettings.vendor_code_next_seq === null || codeSettings.vendor_code_next_seq === undefined) {
      return null;
    }

    const padding = Math.max(1, codeSettings.vendor_code_sequence_padding ?? 4);
    const nextSeq = codeSettings.vendor_code_next_seq + 1;
    const core = nextSeq.toString().padStart(padding, '0');
    const prefix = codeSettings.vendor_code_prefix || '';
    const suffix = codeSettings.vendor_code_suffix || '';
    return normalizeVendorCode(`${prefix}${core}${suffix}`);
  }, [codeSettings, normalizeVendorCode]);

  const validateVendorCode = (value: string) => {
    if (!codeSettings) return [] as string[];

    const code = value.trim();
    const errors: string[] = [];

    if (!code) {
      if (codeSettings.vendor_code_required && codeSettings.vendor_code_strategy === 'manual') {
        errors.push('Vendor code is required.');
      }
      return errors;
    }

    if (codeSettings.vendor_code_min_length && code.length < codeSettings.vendor_code_min_length) {
      errors.push(`Vendor code must be at least ${codeSettings.vendor_code_min_length} characters.`);
    }

    if (codeSettings.vendor_code_max_length && code.length > codeSettings.vendor_code_max_length) {
      errors.push(`Vendor code must be at most ${codeSettings.vendor_code_max_length} characters.`);
    }

    if (codeSettings.vendor_code_prefix && !code.startsWith(codeSettings.vendor_code_prefix)) {
      errors.push(`Vendor code must start with ${codeSettings.vendor_code_prefix}.`);
    }

    if (codeSettings.vendor_code_suffix && !code.endsWith(codeSettings.vendor_code_suffix)) {
      errors.push(`Vendor code must end with ${codeSettings.vendor_code_suffix}.`);
    }

    if (codeSettings.vendor_code_allowed_chars) {
      try {
        const pattern = new RegExp(`^[${codeSettings.vendor_code_allowed_chars}]+$`);
        if (!pattern.test(code)) {
          errors.push('Vendor code contains invalid characters.');
        }
      } catch {
        errors.push('Vendor code rules are misconfigured.');
      }
    }

    if (codeSettings.vendor_code_regex) {
      try {
        const regex = new RegExp(codeSettings.vendor_code_regex);
        if (!regex.test(code)) {
          errors.push('Vendor code does not match required format.');
        }
      } catch {
        errors.push('Vendor code regex is invalid.');
      }
    }

    return errors;
  };

  const sequentialPreviewErrors = useMemo(() => {
    if (!nextSequentialCode || codeSettings?.vendor_code_strategy !== 'sequential') {
      return [] as string[];
    }
    return validateVendorCode(nextSequentialCode);
  }, [nextSequentialCode, codeSettings]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    const codeErrors = validateVendorCode(form.code || '');
    if (codeErrors.length > 0) {
      setSaving(false);
      setError(codeErrors.join(' '));
      return;
    }

    try {
      const payload = {
        ...form,
        lead_time_days: form.lead_time_days ? parseInt(form.lead_time_days) : null,
      };

      if (isEdit && vendor) {
        if (!vendor.last_event_id) {
          throw new Error('Missing last_event_id for this vendor. Please refresh and try again.');
        }

        await SupplyChainRPC.updateVendor(vendor.id, payload, vendor.last_event_id);
      } else {
        await SupplyChainRPC.createVendor({
          ...payload,
          last_event_id: crypto.randomUUID(),
        });
      }

      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-white">
          <h3 className="text-lg font-semibold">{isEdit ? 'Edit Vendor' : 'Create Vendor'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">Vendor Name *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Vendor Code</label>
            <input
              type="text"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: normalizeVendorCode(e.target.value) })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono"
              placeholder={
                codeSettings?.vendor_code_strategy === 'sequential'
                  ? 'Auto-generated'
                  : 'Enter vendor code'
              }
              disabled={
                codeSettings?.vendor_code_strategy === 'sequential' ||
                (isEdit && codeSettings?.vendor_code_user_editable === false)
              }
              required={codeSettings?.vendor_code_required && codeSettings?.vendor_code_strategy === 'manual'}
            />
            {vendorCodeHelp && (
              <p className="text-sm text-gray-500 mt-1">{vendorCodeHelp}</p>
            )}
            {nextSequentialCode && codeSettings?.vendor_code_strategy === 'sequential' && (
              <div className="mt-1 space-y-1 text-sm text-gray-600">
                <p>
                  Next code preview: <span className="font-mono">{nextSequentialCode}</span>
                </p>
                <p className="text-xs text-gray-500">
                  Sequential codes are numeric; choose Hybrid or Manual if you want letters.
                </p>
              </div>
            )}
            {sequentialPreviewErrors.length > 0 && (
              <p className="text-xs text-amber-600 mt-1">
                Current rules would reject the preview: {sequentialPreviewErrors.join(' ')}
              </p>
            )}
            {vendorCodeRules.length > 0 && (
              <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                <div className="font-medium text-gray-700">Code rules</div>
                <div className="mt-1 flex flex-wrap gap-2">
                  {vendorCodeRules.map((rule) => (
                    <span key={rule} className="rounded-full border border-gray-200 bg-white px-2 py-0.5">
                      {rule}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {isEdit && codeSettings?.vendor_code_user_editable === false && (
              <p className="text-sm text-amber-600 mt-1">Vendor code editing is disabled by tenant settings.</p>
            )}
          </div>

          <div className="border-t pt-4">
            <h4 className="font-medium mb-3">Contact Information</h4>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">Contact Name</label>
                <input
                  type="text"
                  value={form.contact_name}
                  onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Email</label>
                <input
                  type="email"
                  value={form.contact_email}
                  onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Phone</label>
                <input
                  type="tel"
                  value={form.contact_phone}
                  onChange={(e) => setForm({ ...form, contact_phone: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>
          </div>

          <div className="border-t pt-4">
            <h4 className="font-medium mb-3">Terms</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Payment Terms</label>
                <select
                  value={form.payment_terms}
                  onChange={(e) => setForm({ ...form, payment_terms: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="NET15">Net 15</option>
                  <option value="NET30">Net 30</option>
                  <option value="NET45">Net 45</option>
                  <option value="NET60">Net 60</option>
                  <option value="COD">COD</option>
                  <option value="PREPAID">Prepaid</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Lead Time (Days)</label>
                <input
                  type="number"
                  value={form.lead_time_days}
                  onChange={(e) => setForm({ ...form, lead_time_days: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="e.g., 14"
                />
              </div>
            </div>
          </div>

          <div className="border-t pt-4">
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              rows={3}
              placeholder="Internal notes about this vendor..."
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? (isEdit ? 'Updating...' : 'Creating...') : (isEdit ? 'Update Vendor' : 'Create Vendor')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
