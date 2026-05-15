'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { StatusChip } from '@/components/ui/StatusChip';
import { ProvisioningRPC } from '@/lib/rpc/provisioning';
import { Plus } from 'lucide-react';

interface Provider {
  id: string;
  name: string;
  key: string;
  type: string | null;
  priority: number;
  is_active: boolean;
  config: Record<string, unknown> | null;
  mappings_count?: number;
  created_at: string;
}

export default function ProvisioningProvidersPage() {
  const router = useRouter();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', key: '', type: 'manual', priority: 0, config: '{}' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchProviders();
  }, []);

  const fetchProviders = async () => {
    setLoading(true);
    try {
      const data = await ProvisioningRPC.getProviders();
      setProviders(data?.data || data || []);
    } catch (error) {
      console.error('Error fetching providers:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      let config: Record<string, unknown>;
      try { config = JSON.parse(form.config); } catch { setError('Invalid JSON in config'); setSaving(false); return; }
      await ProvisioningRPC.createProvider({ name: form.name, key: form.key, type: form.type, priority: form.priority, config });
      setShowCreate(false);
      setForm({ name: '', key: '', type: 'manual', priority: 0, config: '{}' });
      fetchProviders();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  const typeColor: Record<string, string> = {
    manual: 'bg-gray-100 text-gray-700',
    api: 'bg-blue-100 text-blue-700',
    warehouse: 'bg-green-100 text-green-700',
    dropship: 'bg-purple-100 text-purple-700',
  };

  const columns = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      render: (row: Provider) => <span className="font-medium">{row.name}</span>,
    },
    {
      key: 'key',
      header: 'Key',
      render: (row: Provider) => <span className="font-mono text-sm">{row.key}</span>,
    },
    {
      key: 'type',
      header: 'Type',
      render: (row: Provider) => (
        <span className={`inline-flex px-2 py-1 text-xs font-medium rounded ${typeColor[row.type || ''] || typeColor.manual}`}>
          {row.type || 'manual'}
        </span>
      ),
    },
    {
      key: 'priority',
      header: 'Priority',
      sortable: true,
      render: (row: Provider) => <span className="font-mono">{row.priority}</span>,
    },
    {
      key: 'is_active',
      header: 'Active',
      render: (row: Provider) => <StatusChip status={row.is_active ? 'active' : 'inactive'} />,
    },
    {
      key: 'mappings_count',
      header: 'Mappings',
      className: 'text-center',
      render: (row: Provider) => <span className="font-mono">{row.mappings_count ?? '-'}</span>,
    },
    {
      key: 'created_at',
      header: 'Created',
      sortable: true,
      render: (row: Provider) => new Date(row.created_at).toLocaleDateString(),
    },
  ];

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Fulfillment Providers"
          description="Manage external and internal fulfillment providers for provisioning"
          actions={
            <button
              onClick={() => setShowCreate(true)}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Add Provider
            </button>
          }
        />

        <DataTable
          data={providers}
          columns={columns}
          loading={loading}
          emptyMessage="No fulfillment providers configured"
          rowKey={(row) => row.id}
          onRowClick={(row) => router.push(`/provisioning/providers/${row.id}`)}
        />

        {showCreate && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
              <h2 className="text-xl font-semibold mb-4">Add Provider</h2>
              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Name *</label>
                  <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary" required />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Key *</label>
                  <input type="text" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono" required placeholder="e.g. cintas, warehouse_main" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Type</label>
                    <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary">
                      <option value="manual">Manual</option>
                      <option value="api">API</option>
                      <option value="warehouse">Warehouse</option>
                      <option value="dropship">Dropship</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Priority</label>
                    <input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value) || 0 })} className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Config (JSON)</label>
                  <textarea value={form.config} onChange={(e) => setForm({ ...form, config: e.target.value })} className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm" rows={4} />
                </div>
                {error && <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">{error}</div>}
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setShowCreate(false)} className="flex-1 px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50">Cancel</button>
                  <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50">{saving ? 'Creating...' : 'Create'}</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
