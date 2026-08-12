'use client';

/**
 * Assign / Return modal for a single asset unit. Extracted from the Assets
 * page so item detail pages can manage assignments in place too. The mode is
 * derived from the asset's live status: assigned → return flow, else assign.
 */

import { useState } from 'react';
import { EntityImageUpload } from '@/components/ui/EntityImageUpload';
import { InventoryRPC } from '@/lib/rpc/inventory';

/** Structural — both the Assets page rows and item-page units satisfy this. */
export interface AssignableAsset {
  id: string;
  asset_tag: string;
  status?: string | null;
  asset_state?: { current_status?: string | null } | null;
  catalog_item?: { name?: string | null } | null;
}

export interface AssignmentTypeOption {
  type_key: string;
  display_name: string;
  is_active: boolean;
}

export function AssetAssignModal({
  asset,
  assignmentTypes,
  onClose,
  onComplete,
}: {
  asset: AssignableAsset;
  assignmentTypes: AssignmentTypeOption[];
  onClose: () => void;
  onComplete: () => void;
}) {
  // Active assignment types from settings, with a sensible fallback if none are
  // configured yet. Drives the "Assign To" dropdown so custom types show up.
  const FALLBACK_TYPES: { type_key: string; display_name: string }[] = [
    { type_key: 'employee', display_name: 'Employee' },
    { type_key: 'crew', display_name: 'Crew' },
    { type_key: 'vehicle', display_name: 'Vehicle' },
    { type_key: 'job', display_name: 'Job Site' },
    { type_key: 'yard', display_name: 'Yard/Location' },
    { type_key: 'department', display_name: 'Department' },
  ];
  const typeOptions = assignmentTypes.filter((t) => t.is_active).length > 0
    ? assignmentTypes.filter((t) => t.is_active)
    : FALLBACK_TYPES;

  const RETURN_CONDITIONS: { value: 'good' | 'damaged' | 'needs_repair' | 'lost'; label: string }[] = [
    { value: 'good', label: 'Good — back to available' },
    { value: 'damaged', label: 'Damaged — needs repair' },
    { value: 'needs_repair', label: 'Needs repair' },
    { value: 'lost', label: 'Lost — out of service' },
  ];

  const [form, setForm] = useState({
    assigned_to_type: typeOptions[0]?.type_key || 'employee',
    assigned_to_id: '',
    notes: '',
    return_condition: 'good' as 'good' | 'damaged' | 'needs_repair' | 'lost',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const isReturn = (asset.asset_state?.current_status || asset.status) === 'assigned';
  const selectedType = typeOptions.find((t) => t.type_key === form.assigned_to_type);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      if (isReturn) {
        await InventoryRPC.returnAsset({
          asset_id: asset.id,
          return_condition: form.return_condition,
          notes: form.notes,
          last_event_id: crypto.randomUUID(),
        });
      } else {
        await InventoryRPC.assignAsset({
          asset_id: asset.id,
          assigned_to_type: form.assigned_to_type,
          assigned_to_id: form.assigned_to_id,
          notes: form.notes,
          last_event_id: crypto.randomUUID(),
        });
      }

      onComplete();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            {isReturn ? 'Return Asset' : 'Assign Asset'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="p-3 bg-muted/50 rounded-lg flex items-center gap-3">
            <EntityImageUpload entityType="asset" entityId={asset.id} size="sm" />
            <div>
              <div className="text-sm text-muted-foreground">Asset</div>
              <div className="font-medium">{asset.asset_tag}</div>
              <div className="text-sm">{asset.catalog_item?.name}</div>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">
              {error}
            </div>
          )}

          {!isReturn && (
            <>
              <div>
                <label className="block text-sm font-medium mb-1">Assign To *</label>
                <select
                  value={form.assigned_to_type}
                  onChange={(e) => setForm({ ...form, assigned_to_type: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {typeOptions.map((t) => (
                    <option key={t.type_key} value={t.type_key}>{t.display_name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  {selectedType?.display_name || 'Assignee'} *
                </label>
                <input
                  type="text"
                  value={form.assigned_to_id}
                  onChange={(e) => setForm({ ...form, assigned_to_id: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder={`Enter ${(selectedType?.display_name || 'assignee').toLowerCase()} name or ID`}
                  required
                />
              </div>
            </>
          )}

          {isReturn && (
            <div>
              <label className="block text-sm font-medium mb-1">Return Condition *</label>
              <select
                value={form.return_condition}
                onChange={(e) => setForm({ ...form, return_condition: e.target.value as typeof form.return_condition })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {RETURN_CONDITIONS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                Determines the asset&apos;s next status — good returns it to available; damaged or needs-repair sends it to maintenance; lost marks it out of service.
              </p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              rows={2}
              placeholder={isReturn ? 'Condition notes...' : 'Assignment notes...'}
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
              {saving ? 'Processing...' : isReturn ? 'Return Asset' : 'Assign Asset'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
