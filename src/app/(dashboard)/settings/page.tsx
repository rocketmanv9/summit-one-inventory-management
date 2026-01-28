'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';

interface TenantSettings {
  id: string;
  tenant_id: string;
  po_number_format: string;
  po_number_prefix: string | null;
  auto_approve_enabled: boolean;
  auto_approve_limit: number | null;
  vendor_auto_approve_limits: Record<string, number> | null;
  updated_at: string;
}

interface Vendor {
  id: string;
  name: string;
  code: string;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorLimits, setVendorLimits] = useState<Record<string, string>>({});

  const [form, setForm] = useState({
    po_number_format: 'sequential-year',
    po_number_prefix: '',
    auto_approve_enabled: false,
    auto_approve_limit: '',
  });

  useEffect(() => {
    fetchSettings();
    fetchVendors();
    checkAdminStatus();
  }, []);

  const checkAdminStatus = async () => {
    try {
      // Check if user has admin role from session
      const res = await fetch('/api/auth/me');
      const { data } = await res.json();
      setIsAdmin(data?.role === 'admin');
    } catch (error) {
      console.error('Error checking admin status:', error);
      setIsAdmin(false);
    }
  };

  const fetchVendors = async () => {
    try {
      const res = await fetch('/api/inventory/vendors');
      const { data } = await res.json();
      setVendors(data || []);
    } catch (error) {
      console.error('Error fetching vendors:', error);
    }
  };

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/settings/tenant');
      const { data } = await res.json();
      
      if (data) {
        setSettings(data);
        setForm({
          po_number_format: data.po_number_format || 'sequential-year',
          po_number_prefix: data.po_number_prefix || '',
          auto_approve_enabled: data.auto_approve_enabled || false,
          auto_approve_limit: data.auto_approve_limit ? data.auto_approve_limit.toString() : '',
        });
        
        // Load vendor-specific limits
        const limits: Record<string, string> = {};
        if (data.vendor_auto_approve_limits) {
          Object.entries(data.vendor_auto_approve_limits).forEach(([vendorId, limit]) => {
            limits[vendorId] = limit.toString();
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

      const res = await fetch('/api/settings/tenant', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          po_number_format: form.po_number_format,
          po_number_prefix: form.po_number_prefix || null,
          auto_approve_enabled: form.auto_approve_enabled,
          auto_approve_limit: form.auto_approve_limit ? parseFloat(form.auto_approve_limit) : null,
          vendor_auto_approve_limits: vendorLimitsObj,
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        setError(result.error || result.message || 'Failed to update settings');
        return;
      }

      setSuccess('Settings updated successfully!');
      setSettings(result.data);
      
      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      console.error('Error updating settings:', error);
      setError('Failed to update settings. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const formatExamples = {
    'sequential-year': '26-0001, 26-0002, 26-0003 (resets each year)',
    'sequential': '0001, 0002, 0003 (continuous)',
    'timestamp': 'PO-MKY42T62 (timestamp-based)',
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
        subtitle="Configure purchase order numbering and approval rules"
      />

      {!isAdmin && (
        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-yellow-800 font-medium">⚠️ Admin Access Required</p>
          <p className="text-yellow-700 text-sm mt-1">
            You are viewing settings in read-only mode. Only administrators can modify these settings.
          </p>
        </div>
      )}

      <div className="max-w-3xl">
        <form onSubmit={handleSubmit} className="bg-white rounded-lg border p-6 space-y-6">
          {/* PO Numbering Section */}
          <div>
            <h3 className="text-lg font-semibold mb-4 pb-2 border-b">Purchase Order Numbering</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Number Format</label>
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
                  Number Prefix (Optional)
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
          </div>

          {/* Auto-Approval Section */}
          <div>
            <h3 className="text-lg font-semibold mb-4 pb-2 border-b">Auto-Approval Rules</h3>
            
            <div className="space-y-4">
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

                  {/* Vendor-Specific Limits */}
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
                              {vendor.name} ({vendor.code})
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
