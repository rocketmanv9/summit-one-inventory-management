'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { AppError } from '@rocketmanv9/chassis/errors';

interface UomConversion {
  id: string;
  from_uom: string;
  to_uom: string;
  conversion_factor: number;
  is_bidirectional: boolean;
  last_event_id: string;
  created_at: string;
}

export default function UomConversionsPage() {
  const [conversions, setConversions] = useState<UomConversion[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    fetchConversions();
  }, []);

  const fetchConversions = async () => {
    setLoading(true);
    try {
      const data = await InventoryRPC.getUomConversions();
      setConversions(data);
    } catch (error) {
      console.error('Error fetching UOM conversions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (conv: UomConversion) => {
    if (!confirm(`Delete conversion ${conv.from_uom} -> ${conv.to_uom}?`)) return;
    try {
      await InventoryRPC.deleteUomConversion(conv.id, conv.last_event_id);
      await fetchConversions();
    } catch (error: any) {
      alert(error?.message || 'Failed to delete conversion');
    }
  };

  const columns = [
    {
      key: 'from_uom',
      header: 'From UOM',
      sortable: true,
      render: (row: UomConversion) => (
        <code className="bg-gray-100 px-2 py-1 rounded text-sm">{row.from_uom}</code>
      ),
    },
    {
      key: 'to_uom',
      header: 'To UOM',
      sortable: true,
      render: (row: UomConversion) => (
        <code className="bg-gray-100 px-2 py-1 rounded text-sm">{row.to_uom}</code>
      ),
    },
    {
      key: 'conversion_factor',
      header: 'Factor',
      className: 'text-right font-mono',
      render: (row: UomConversion) => row.conversion_factor,
    },
    {
      key: 'is_bidirectional',
      header: 'Bidirectional',
      render: (row: UomConversion) => (
        <span className={`inline-flex px-2 py-1 text-xs font-medium rounded ${
          row.is_bidirectional ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
        }`}>
          {row.is_bidirectional ? 'Yes' : 'No'}
        </span>
      ),
    },
    {
      key: 'description',
      header: 'Meaning',
      render: (row: UomConversion) => (
        <span className="text-sm text-muted-foreground">
          1 {row.from_uom} = {row.conversion_factor} {row.to_uom}
          {row.is_bidirectional && ` (and 1 ${row.to_uom} = ${(1 / row.conversion_factor).toFixed(6)} ${row.from_uom})`}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (row: UomConversion) => (
        <button
          onClick={() => handleDelete(row)}
          className="text-red-600 hover:text-red-800 text-sm font-medium"
        >
          Delete
        </button>
      ),
    },
  ];

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="UOM Conversions"
          description="Manage unit of measure conversion rules. Define how to convert between different units (e.g., 1 Dozen = 12 Each)."
          actions={
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              + Add Conversion
            </button>
          }
        />

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex gap-2">
            <span className="text-blue-600">i</span>
            <div className="flex-1">
              <h3 className="font-medium text-blue-900">About UOM Conversions</h3>
              <p className="text-sm text-blue-700 mt-1">
                UOM conversions let you express quantities in different units. Bidirectional conversions
                work both ways automatically. The system can chain conversions (A to B to C) if a direct
                path is not available.
              </p>
            </div>
          </div>
        </div>

        <DataTable
          data={conversions}
          columns={columns}
          loading={loading}
          emptyMessage="No UOM conversions configured. Add conversions to enable unit conversion across your inventory."
          rowKey={(row) => row.id}
        />

        {showCreateModal && (
          <CreateUomConversionModal
            onClose={() => setShowCreateModal(false)}
            onCreated={() => {
              setShowCreateModal(false);
              fetchConversions();
            }}
          />
        )}
      </div>
    </AppShell>
  );
}

function CreateUomConversionModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    from_uom: '',
    to_uom: '',
    conversion_factor: '',
    is_bidirectional: true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      if (!form.from_uom || !form.to_uom || !form.conversion_factor) {
        throw AppError.badRequest('All fields are required');
      }

      const factor = parseFloat(form.conversion_factor);
      if (isNaN(factor) || factor <= 0) {
        throw AppError.badRequest('Conversion factor must be a positive number');
      }

      await InventoryRPC.createUomConversion({
        from_uom: form.from_uom.toUpperCase(),
        to_uom: form.to_uom.toUpperCase(),
        conversion_factor: factor,
        is_bidirectional: form.is_bidirectional,
      });

      onCreated();
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
          <h3 className="text-lg font-semibold">Add UOM Conversion</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">x</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">From UOM *</label>
              <input
                type="text"
                value={form.from_uom}
                onChange={(e) => setForm({ ...form, from_uom: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="e.g., EA"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">To UOM *</label>
              <input
                type="text"
                value={form.to_uom}
                onChange={(e) => setForm({ ...form, to_uom: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="e.g., DZ"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Conversion Factor *</label>
            <input
              type="number"
              step="any"
              value={form.conversion_factor}
              onChange={(e) => setForm({ ...form, conversion_factor: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="e.g., 12 (1 DZ = 12 EA)"
              required
            />
            <p className="text-xs text-gray-500 mt-1">
              How many &quot;To&quot; units in 1 &quot;From&quot; unit. Example: 1 EA = 1/12 DZ, so factor is 0.0833
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="bidirectional"
              checked={form.is_bidirectional}
              onChange={(e) => setForm({ ...form, is_bidirectional: e.target.checked })}
              className="rounded border-gray-300"
            />
            <label htmlFor="bidirectional" className="text-sm">
              Bidirectional (allows reverse conversion automatically)
            </label>
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
              {saving ? 'Creating...' : 'Create Conversion'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
