'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { InventoryRPC } from '@/lib/rpc/inventory';

interface GuardrailPolicy {
  id?: string;
  over_receipt_policy: string;
  over_receipt_threshold_pct: number;
  uom_mismatch_policy: string;
  require_override_reason: boolean;
}

interface GuardrailException {
  id: string;
  actor_user_id: string | null;
  context_type: string;
  context_id: string;
  rule: string;
  override_reason: string;
  metadata: Record<string, any>;
  created_at: string;
}

export default function GuardrailSettingsPage() {
  const [policy, setPolicy] = useState<GuardrailPolicy>({
    over_receipt_policy: 'block',
    over_receipt_threshold_pct: 0,
    uom_mismatch_policy: 'warn',
    require_override_reason: true,
  });
  const [exceptions, setExceptions] = useState<GuardrailException[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [policyData, exceptionData] = await Promise.all([
        InventoryRPC.getGuardrailPolicies(),
        InventoryRPC.getGuardrailExceptions({ limit: 50 }),
      ]);

      if (policyData) {
        setPolicy({
          id: policyData.id,
          over_receipt_policy: policyData.over_receipt_policy,
          over_receipt_threshold_pct: policyData.over_receipt_threshold_pct,
          uom_mismatch_policy: policyData.uom_mismatch_policy,
          require_override_reason: policyData.require_override_reason,
        });
      }

      setExceptions(exceptionData);
    } catch (err) {
      console.error('Error loading guardrail settings:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      await InventoryRPC.upsertGuardrailPolicies({
        over_receipt_policy: policy.over_receipt_policy,
        over_receipt_threshold_pct: policy.over_receipt_threshold_pct,
        uom_mismatch_policy: policy.uom_mismatch_policy,
        require_override_reason: policy.require_override_reason,
      });
      setSuccess('Guardrail policies saved.');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to save policies.');
    } finally {
      setSaving(false);
    }
  };

  const exceptionColumns = [
    {
      key: 'created_at',
      header: 'When',
      render: (row: GuardrailException) => (
        <span className="text-sm">{new Date(row.created_at).toLocaleString()}</span>
      ),
    },
    {
      key: 'rule',
      header: 'Rule',
      render: (row: GuardrailException) => (
        <span className={`inline-flex px-2 py-1 text-xs font-medium rounded ${
          row.rule === 'negative_inventory' ? 'bg-red-100 text-red-800' :
          row.rule === 'over_receipt' ? 'bg-orange-100 text-orange-800' :
          'bg-yellow-100 text-yellow-800'
        }`}>
          {row.rule.replace(/_/g, ' ')}
        </span>
      ),
    },
    {
      key: 'context_type',
      header: 'Context',
      render: (row: GuardrailException) => (
        <span className="text-sm capitalize">{row.context_type}</span>
      ),
    },
    {
      key: 'override_reason',
      header: 'Override Reason',
      render: (row: GuardrailException) => (
        <span className="text-sm">{row.override_reason}</span>
      ),
    },
    {
      key: 'metadata',
      header: 'Details',
      render: (row: GuardrailException) => {
        const meta = row.metadata || {};
        const details: string[] = [];
        if (meta.item_name) details.push(meta.item_name);
        if (meta.location_name) details.push(`at ${meta.location_name}`);
        if (meta.transfer_number) details.push(`TRF ${meta.transfer_number}`);
        if (meta.receipt_number) details.push(`RCV ${meta.receipt_number}`);
        if (meta.old_qty !== undefined && meta.new_qty !== undefined) {
          details.push(`${meta.old_qty} -> ${meta.new_qty}`);
        }
        return <span className="text-xs text-muted-foreground">{details.join(' ') || '-'}</span>;
      },
    },
  ];

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500">Loading guardrail settings...</div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-6 max-w-4xl">
        <PageHeader
          title="Guardrail Policies"
          description="Configure operational guardrails to prevent inventory mistakes. These policies apply to all stock mutations (adjustments, transfers, receiving)."
        />

        {/* Info Box */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex gap-2">
            <span className="text-blue-600">i</span>
            <div className="flex-1">
              <h3 className="font-medium text-blue-900">How Guardrails Work</h3>
              <p className="text-sm text-blue-700 mt-1">
                Guardrails prevent common inventory errors. When set to &quot;Block&quot;, the operation is rejected
                with a clear error message. When set to &quot;Allow with audit&quot;, the user can override with a
                reason that is logged for review. Negative inventory rules are managed separately in the
                <a href="/settings/negative-inventory" className="underline ml-1">Negative Inventory</a> settings.
              </p>
            </div>
          </div>
        </div>

        {/* Policy Form */}
        <form onSubmit={handleSave} className="bg-white rounded-lg border p-6 space-y-5">
          <h3 className="text-lg font-semibold pb-2 border-b">Policy Configuration</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium mb-1">Over-Receipt Policy</label>
              <select
                value={policy.over_receipt_policy}
                onChange={(e) => setPolicy({ ...policy, over_receipt_policy: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="block">Block (reject over-receipt)</option>
                <option value="allow_with_audit">Allow with audit (require reason)</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Controls what happens when receiving more than the PO open quantity.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Over-Receipt Tolerance (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={policy.over_receipt_threshold_pct}
                onChange={(e) => setPolicy({ ...policy, over_receipt_threshold_pct: parseFloat(e.target.value) || 0 })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-xs text-gray-500 mt-1">
                Allow this % above PO quantity before the policy kicks in. 0 = exact match.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">UOM Mismatch Policy</label>
              <select
                value={policy.uom_mismatch_policy}
                onChange={(e) => setPolicy({ ...policy, uom_mismatch_policy: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="block">Block (reject if no conversion)</option>
                <option value="warn">Warn (allow but log)</option>
                <option value="off">Off (no check)</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Controls validation when receiving in a different UOM than the item&apos;s base UOM.
              </p>
            </div>

            <div className="flex items-start pt-6">
              <input
                type="checkbox"
                id="require_override"
                checked={policy.require_override_reason}
                onChange={(e) => setPolicy({ ...policy, require_override_reason: e.target.checked })}
                className="w-4 h-4 text-primary focus:ring-2 focus:ring-primary rounded mt-0.5"
              />
              <label htmlFor="require_override" className="ml-2">
                <span className="text-sm font-medium">Require override reason</span>
                <p className="text-xs text-gray-500">
                  When &quot;allow with audit&quot; policies are triggered, require a written reason.
                </p>
              </label>
            </div>
          </div>

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

          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Policies'}
          </button>
        </form>

        {/* Related Settings Links */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <a
            href="/settings/negative-inventory"
            className="p-4 bg-white rounded-lg border hover:border-primary/50 transition-colors"
          >
            <h4 className="font-medium">Negative Inventory Rules</h4>
            <p className="text-sm text-muted-foreground mt-1">
              Configure which items/categories can go below zero stock.
            </p>
          </a>
          <a
            href="/settings/uom-conversions"
            className="p-4 bg-white rounded-lg border hover:border-primary/50 transition-colors"
          >
            <h4 className="font-medium">UOM Conversions</h4>
            <p className="text-sm text-muted-foreground mt-1">
              Define unit-of-measure conversion factors (e.g., 1 Dozen = 12 Each).
            </p>
          </a>
        </div>

        {/* Exception Audit Log */}
        <div className="space-y-3">
          <h3 className="text-lg font-semibold">Override Audit Log</h3>
          <p className="text-sm text-muted-foreground">
            Recent guardrail overrides. Each entry shows who overrode a guardrail and why.
          </p>
          <DataTable
            data={exceptions}
            columns={exceptionColumns}
            loading={false}
            emptyMessage="No guardrail overrides have been logged yet."
            rowKey={(row) => row.id}
          />
        </div>
      </div>
    </AppShell>
  );
}
