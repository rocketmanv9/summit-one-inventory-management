'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { SupplyChainRPC } from '@/lib/rpc/supply-chain';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { Package, Plus, AlertCircle, Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { AppError } from '@rocketmanv9/chassis/errors';

interface Location {
  id: string;
  name: string;
  location_type: string;
}

interface CatalogItem {
  id: string;
  name: string;
  sku: string;
  unit_of_measure: string | null;
}

interface ReceiptLine {
  catalog_item_id: string;
  qty_received: number;
}

export default function CreateReceiptPage() {
  const router = useRouter();
  const [locations, setLocations] = useState<Location[]>([]);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const [form, setForm] = useState({
    receipt_number: '',
    location_id: '',
    received_at: new Date().toISOString().split('T')[0],
    notes: '',
    auto_post: true,
  });

  const [lines, setLines] = useState<ReceiptLine[]>([
    { catalog_item_id: '', qty_received: 0 },
  ]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [locationsData, itemsData] = await Promise.all([
        InventoryRPC.getLocations({ active: true }),
        InventoryRPC.getCatalogItems({ active: true }),
      ]);
      setLocations(locationsData);
      setItems(itemsData);
    } catch (err: any) {
      setError(`Failed to load data: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const addLine = () => {
    setLines([...lines, { catalog_item_id: '', qty_received: 0 }]);
  };

  const removeLine = (index: number) => {
    setLines(lines.filter((_, i) => i !== index));
  };

  const updateLine = (index: number, field: keyof ReceiptLine, value: any) => {
    const newLines = [...lines];
    newLines[index] = { ...newLines[index], [field]: value };
    setLines(newLines);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    setSuccess(false);

    try {
      // Validate
      if (!form.location_id) {
        throw AppError.badRequest('Please select a location');
      }

      const validLines = lines.filter(
        (line) => line.catalog_item_id && line.qty_received > 0
      );

      if (validLines.length === 0) {
        throw AppError.badRequest('Please add at least one item with quantity > 0');
      }

      // Create receipt using RPC
      const result = await SupplyChainRPC.createReceipt({
        receipt_number: form.receipt_number || undefined,
        location_id: form.location_id,
        lines: validLines,
        received_at: form.received_at,
        notes: form.notes || undefined,
        auto_post: form.auto_post,
      });

      setSuccess(true);
      setTimeout(() => {
        router.push('/inventory/receiving');
      }, 2000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <AppShell>
        <div className="p-8">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-gray-200 rounded w-64"></div>
            <div className="h-64 bg-gray-200 rounded"></div>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="p-6 max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Create Receipt</h1>
          <p className="mt-2 text-sm text-gray-600">
            Receive goods into inventory (uses RPC: supply_chain.rpc_create_receipt)
          </p>
        </div>

        {/* Success Message */}
        {success && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
            <Check className="h-5 w-5 text-green-600" />
            <span className="text-green-800">Receipt created successfully! Redirecting...</span>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-red-600" />
            <span className="text-red-800">{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Receipt Header */}
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <h2 className="text-lg font-semibold mb-4">Receipt Information</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Receipt Number (optional)
                </label>
                <input
                  type="text"
                  value={form.receipt_number}
                  onChange={(e) => setForm({ ...form, receipt_number: e.target.value })}
                  placeholder="Auto-generated if left blank"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">Leave blank for auto-generation</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Location *
                </label>
                <select
                  value={form.location_id}
                  onChange={(e) => setForm({ ...form, location_id: e.target.value })}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select location...</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name} ({loc.location_type})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Received Date
                </label>
                <input
                  type="date"
                  value={form.received_at}
                  onChange={(e) => setForm({ ...form, received_at: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="flex items-center cursor-pointer mt-6">
                  <input
                    type="checkbox"
                    checked={form.auto_post}
                    onChange={(e) => setForm({ ...form, auto_post: e.target.checked })}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <span className="ml-2 text-sm font-medium text-gray-700">
                    Auto-post to inventory
                  </span>
                </label>
                <p className="ml-6 mt-1 text-xs text-gray-500">
                  Automatically update stock balances
                </p>
              </div>
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notes
              </label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
                placeholder="Optional notes about this receipt..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Receipt Lines */}
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Items</h2>
              <button
                type="button"
                onClick={addLine}
                className="inline-flex items-center px-3 py-1.5 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Line
              </button>
            </div>

            <div className="space-y-3">
              {lines.map((line, index) => (
                <div key={index} className="flex gap-3 items-start">
                  <div className="flex-1">
                    <select
                      value={line.catalog_item_id}
                      onChange={(e) => updateLine(index, 'catalog_item_id', e.target.value)}
                      required
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select item...</option>
                      {items.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} ({item.sku}) - {item.unit_of_measure}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="w-32">
                    <input
                      type="number"
                      value={line.qty_received || ''}
                      onChange={(e) => updateLine(index, 'qty_received', parseFloat(e.target.value) || 0)}
                      placeholder="Qty"
                      min="0"
                      step="0.01"
                      required
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {lines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeLine(index)}
                      className="px-3 py-2 text-red-600 hover:text-red-800"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => router.back()}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-gray-700 bg-white hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Creating...' : 'Create Receipt'}
            </button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
