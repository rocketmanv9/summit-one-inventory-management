'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { StatusChip } from '@/components/ui/StatusChip';
import { ProvisioningRPC } from '@/lib/rpc/provisioning';
import { Plus } from 'lucide-react';

interface Kit {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  line_count?: number;
  lines?: Array<Record<string, unknown>>;
  created_at: string;
}

export default function ProvisioningKitsPage() {
  const router = useRouter();
  const [kits, setKits] = useState<Kit[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchKits();
  }, []);

  const fetchKits = async () => {
    setLoading(true);
    try {
      const data = await ProvisioningRPC.getKits();
      setKits(data?.data || data || []);
    } catch (error) {
      console.error('Error fetching kits:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await ProvisioningRPC.createKit({ name: form.name, description: form.description || undefined });
      setShowCreate(false);
      setForm({ name: '', description: '' });
      fetchKits();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      render: (row: Kit) => <span className="font-medium">{row.name}</span>,
    },
    {
      key: 'description',
      header: 'Description',
      render: (row: Kit) => (
        <span className="text-sm text-muted-foreground">{row.description || '-'}</span>
      ),
    },
    {
      key: 'line_count',
      header: 'Items',
      className: 'text-center',
      render: (row: Kit) => (
        <span className="font-mono">{row.line_count ?? row.lines?.length ?? 0}</span>
      ),
    },
    {
      key: 'is_active',
      header: 'Active',
      render: (row: Kit) => (
        <StatusChip status={row.is_active ? 'active' : 'inactive'} />
      ),
    },
    {
      key: 'created_at',
      header: 'Created',
      sortable: true,
      render: (row: Kit) => new Date(row.created_at).toLocaleDateString(),
    },
  ];

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Provisioning Kits"
          description="Define reusable bundles of items to provision to employees"
          actions={
            <button
              onClick={() => setShowCreate(true)}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Create Kit
            </button>
          }
        />

        <DataTable
          data={kits}
          columns={columns}
          loading={loading}
          emptyMessage="No provisioning kits created yet"
          rowKey={(row) => row.id}
          onRowClick={(row) => router.push(`/provisioning/kits/${row.id}`)}
        />

        {showCreate && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full">
              <h2 className="text-xl font-semibold mb-4">Create Kit</h2>
              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Name *</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Description</label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    rows={3}
                  />
                </div>
                {error && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">{error}</div>
                )}
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setShowCreate(false)} className="flex-1 px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50">Cancel</button>
                  <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50">
                    {saving ? 'Creating...' : 'Create'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
