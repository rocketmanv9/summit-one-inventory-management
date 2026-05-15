'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { ProvisioningRPC } from '@/lib/rpc/provisioning';
import { Plus, Pencil, FlaskConical, Trash2 } from 'lucide-react';

interface Policy {
  id: string;
  name: string;
  priority: number;
  conditions: Record<string, unknown> | null;
  kit_id: string | null;
  kit_name?: string | null;
  trigger_events: string[] | null;
  is_active: boolean;
  created_at: string;
}

interface PolicyForm {
  name: string;
  priority: number;
  conditions: string;
  kit_id: string;
  trigger_events: string;
  is_active: boolean;
}

const emptyForm: PolicyForm = {
  name: '',
  priority: 0,
  conditions: '{}',
  kit_id: '',
  trigger_events: '',
  is_active: true,
};

export default function ProvisioningPoliciesPage() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<Policy | null>(null);
  const [form, setForm] = useState<PolicyForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showDryRun, setShowDryRun] = useState(false);
  const [dryRunEvent, setDryRunEvent] = useState('new_hire');
  const [dryRunEmployee, setDryRunEmployee] = useState('{}');
  const [dryRunResult, setDryRunResult] = useState<unknown>(null);
  const [dryRunLoading, setDryRunLoading] = useState(false);

  useEffect(() => {
    fetchPolicies();
  }, []);

  const fetchPolicies = async () => {
    setLoading(true);
    try {
      const data = await ProvisioningRPC.getPolicies();
      setPolicies(data?.data || data || []);
    } catch (error) {
      console.error('Error fetching policies:', error);
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setEditingPolicy(null);
    setForm(emptyForm);
    setError('');
    setShowModal(true);
  };

  const openEdit = (policy: Policy) => {
    setEditingPolicy(policy);
    setForm({
      name: policy.name,
      priority: policy.priority,
      conditions: JSON.stringify(policy.conditions || {}, null, 2),
      kit_id: policy.kit_id || '',
      trigger_events: (policy.trigger_events || []).join(', '),
      is_active: policy.is_active,
    });
    setError('');
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      let conditions: Record<string, unknown>;
      try {
        conditions = JSON.parse(form.conditions);
      } catch {
        setError('Invalid JSON in conditions');
        setSaving(false);
        return;
      }

      const payload = {
        name: form.name,
        priority: form.priority,
        conditions,
        kit_id: form.kit_id || null,
        trigger_events: form.trigger_events
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        is_active: form.is_active,
      };

      if (editingPolicy) {
        await ProvisioningRPC.updatePolicy(editingPolicy.id, payload);
      } else {
        await ProvisioningRPC.createPolicy(payload);
      }

      setShowModal(false);
      fetchPolicies();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (policy: Policy) => {
    try {
      await ProvisioningRPC.updatePolicy(policy.id, { is_active: !policy.is_active });
      fetchPolicies();
    } catch (error) {
      console.error('Error toggling policy:', error);
    }
  };

  const handleDryRun = async () => {
    setDryRunLoading(true);
    setDryRunResult(null);
    try {
      let employee: Record<string, unknown>;
      try {
        employee = JSON.parse(dryRunEmployee);
      } catch {
        setDryRunResult({ error: 'Invalid JSON in employee data' });
        setDryRunLoading(false);
        return;
      }
      const result = await ProvisioningRPC.evaluatePolicy({
        trigger_event: dryRunEvent,
        employee,
      });
      setDryRunResult(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setDryRunResult({ error: message });
    } finally {
      setDryRunLoading(false);
    }
  };

  const columns = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      render: (row: Policy) => <span className="font-medium">{row.name}</span>,
    },
    {
      key: 'priority',
      header: 'Priority',
      sortable: true,
      render: (row: Policy) => <span className="font-mono">{row.priority}</span>,
    },
    {
      key: 'conditions',
      header: 'Conditions',
      render: (row: Policy) => {
        const conds = row.conditions || {};
        const keys = Object.keys(conds);
        if (keys.length === 0) return <span className="text-muted-foreground">None</span>;
        return (
          <div className="flex flex-wrap gap-1">
            {keys.slice(0, 3).map((k) => (
              <span key={k} className="inline-flex px-2 py-0.5 text-xs rounded-full bg-purple-100 text-purple-700">
                {k}: {String(conds[k])}
              </span>
            ))}
            {keys.length > 3 && (
              <span className="text-xs text-muted-foreground">+{keys.length - 3}</span>
            )}
          </div>
        );
      },
    },
    {
      key: 'kit_name',
      header: 'Kit',
      render: (row: Policy) => row.kit_name || row.kit_id || '-',
    },
    {
      key: 'trigger_events',
      header: 'Trigger Events',
      render: (row: Policy) => {
        const events = row.trigger_events || [];
        if (events.length === 0) return <span className="text-muted-foreground">-</span>;
        return (
          <div className="flex flex-wrap gap-1">
            {events.map((ev) => (
              <span key={ev} className="inline-flex px-2 py-0.5 text-xs rounded-full bg-indigo-100 text-indigo-700">
                {ev.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        );
      },
    },
    {
      key: 'is_active',
      header: 'Active',
      render: (row: Policy) => (
        <button
          onClick={(e) => { e.stopPropagation(); handleToggleActive(row); }}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            row.is_active ? 'bg-green-500' : 'bg-gray-300'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              row.is_active ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (row: Policy) => (
        <div className="flex gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); openEdit(row); }}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-600"
            title="Edit"
          >
            <Pencil className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Provisioning Policies"
          description="Define rules that automatically assign kits to employees based on attributes and trigger events"
          actions={
            <div className="flex gap-2">
              <button
                onClick={() => setShowDryRun(true)}
                className="px-4 py-2 border border-gray-200 text-gray-700 rounded-md hover:bg-gray-50 flex items-center gap-2"
              >
                <FlaskConical className="h-4 w-4" />
                Test Policy
              </button>
              <button
                onClick={openCreate}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 flex items-center gap-2"
              >
                <Plus className="h-4 w-4" />
                Create Policy
              </button>
            </div>
          }
        />

        <DataTable
          data={policies}
          columns={columns}
          loading={loading}
          emptyMessage="No provisioning policies configured"
          rowKey={(row) => row.id}
        />

        {/* Create/Edit Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
              <h2 className="text-xl font-semibold mb-4">
                {editingPolicy ? 'Edit Policy' : 'Create Policy'}
              </h2>
              <form onSubmit={handleSave} className="space-y-4">
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
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Priority</label>
                    <input
                      type="number"
                      value={form.priority}
                      onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value) || 0 })}
                      className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Kit ID</label>
                    <input
                      type="text"
                      value={form.kit_id}
                      onChange={(e) => setForm({ ...form, kit_id: e.target.value })}
                      className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                      placeholder="UUID..."
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Trigger Events (comma-separated)</label>
                  <input
                    type="text"
                    value={form.trigger_events}
                    onChange={(e) => setForm({ ...form, trigger_events: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="new_hire, role_change, promotion"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Conditions (JSON)</label>
                  <textarea
                    value={form.conditions}
                    onChange={(e) => setForm({ ...form, conditions: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
                    rows={5}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="policy-active"
                    checked={form.is_active}
                    onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  />
                  <label htmlFor="policy-active" className="text-sm font-medium">Active</label>
                </div>

                {error && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">{error}</div>
                )}

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="flex-1 px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : editingPolicy ? 'Update' : 'Create'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Dry Run Modal */}
        {showDryRun && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
              <h2 className="text-xl font-semibold mb-4">Test Policy Evaluation</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Trigger Event</label>
                  <input
                    type="text"
                    value={dryRunEvent}
                    onChange={(e) => setDryRunEvent(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="new_hire"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Employee Attributes (JSON)</label>
                  <textarea
                    value={dryRunEmployee}
                    onChange={(e) => setDryRunEmployee(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
                    rows={5}
                    placeholder='{"department": "engineering", "role": "developer"}'
                  />
                </div>
                <button
                  onClick={handleDryRun}
                  disabled={dryRunLoading}
                  className="w-full px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md disabled:opacity-50"
                >
                  {dryRunLoading ? 'Evaluating...' : 'Evaluate'}
                </button>

                {dryRunResult != null && (
                  <div className="mt-4 p-4 rounded-lg border bg-muted/30">
                    <h4 className="text-sm font-semibold mb-2">Result</h4>
                    <pre className="text-xs overflow-x-auto whitespace-pre-wrap font-mono">
                      {JSON.stringify(dryRunResult, null, 2)}
                    </pre>
                  </div>
                )}

                <button
                  onClick={() => { setShowDryRun(false); setDryRunResult(null); }}
                  className="w-full px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
