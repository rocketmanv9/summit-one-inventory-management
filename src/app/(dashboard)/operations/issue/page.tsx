'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { Package, Plus, AlertCircle, Check, Info } from 'lucide-react';
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

interface StockBalance {
  catalog_item_id: string;
  qty_available: number;
}

interface IssueItem {
  catalog_item_id: string;
  qty_issued: number;
}

export default function IssueInventoryPage() {
  const router = useRouter();
  const [locations, setLocations] = useState<Location[]>([]);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [stockBalances, setStockBalances] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const [form, setForm] = useState({
    location_id: '',
    issued_to_type: 'job' as 'job' | 'truck' | 'person' | 'other',
    issued_to_ref: '',
    reason: '',
    notes: '',
  });

  const [issueItems, setIssueItems] = useState<IssueItem[]>([
    { catalog_item_id: '', qty_issued: 0 },
  ]);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (form.location_id) {
      loadStockBalances();
    }
  }, [form.location_id]);

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

  const loadStockBalances = async () => {
    try {
      const balances = await InventoryRPC.getStockBalances({
        location_id: form.location_id,
      });

      const balanceMap: Record<string, number> = {};
      balances.forEach((b) => {
        balanceMap[b.catalog_item_id] = b.qty_available;
      });

      setStockBalances(balanceMap);
    } catch (err: any) {
      console.error('Failed to load stock balances:', err);
    }
  };

  const addItem = () => {
    setIssueItems([...issueItems, { catalog_item_id: '', qty_issued: 0 }]);
  };

  const removeItem = (index: number) => {
    setIssueItems(issueItems.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, field: keyof IssueItem, value: any) => {
    const newItems = [...issueItems];
    newItems[index] = { ...newItems[index], [field]: value };
    setIssueItems(newItems);
  };

  const getAvailableQty = (itemId: string): number => {
    return stockBalances[itemId] || 0;
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

      if (!form.issued_to_ref) {
        throw AppError.badRequest('Please enter who/what the inventory is issued to');
      }

      const validItems = issueItems.filter(
        (item) => item.catalog_item_id && item.qty_issued > 0
      );

      if (validItems.length === 0) {
        throw AppError.badRequest('Please add at least one item with quantity > 0');
      }

      // Check availability
      for (const item of validItems) {
        const available = getAvailableQty(item.catalog_item_id);
        if (item.qty_issued > available) {
          const itemName = items.find((i) => i.id === item.catalog_item_id)?.name || 'Unknown';
          throw AppError.badRequest(
            `Insufficient stock for ${itemName}. Available: ${available}, Requested: ${item.qty_issued}`
          );
        }
      }

      // Issue inventory using RPC
      const result = await InventoryRPC.issueInventory({
        location_id: form.location_id,
        items: validItems,
        issued_to_type: form.issued_to_type,
        issued_to_ref: form.issued_to_ref,
        reason: form.reason || `Issued to ${form.issued_to_type}`,
        notes: form.notes || undefined,
      });

      setSuccess(true);
      setTimeout(() => {
        router.push('/inventory/movements');
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
          <h1 className="text-3xl font-bold text-gray-900">Issue Inventory</h1>
          <p className="mt-2 text-sm text-gray-600">
            Release inventory from location (uses RPC: inventory.rpc_issue_inventory)
          </p>
        </div>

        {/* Info Banner */}
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg flex items-start gap-2">
          <Info className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-blue-800">
            <strong>RPC-based operation:</strong> This form uses the atomic RPC
            inventory.rpc_issue_inventory() which validates availability, creates ledger events,
            and updates stock balances in a single transaction.
          </div>
        </div>

        {/* Success Message */}
        {success && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
            <Check className="h-5 w-5 text-green-600" />
            <span className="text-green-800">Inventory issued successfully! Redirecting...</span>
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
          {/* Issue Header */}
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <h2 className="text-lg font-semibold mb-4">Issue Information</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  From Location *
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
                  Issued To Type *
                </label>
                <select
                  value={form.issued_to_type}
                  onChange={(e) =>
                    setForm({ ...form, issued_to_type: e.target.value as any })
                  }
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="job">Job</option>
                  <option value="truck">Truck</option>
                  <option value="person">Person</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {form.issued_to_type === 'job' && 'Job Number/Reference *'}
                  {form.issued_to_type === 'truck' && 'Truck Number/ID *'}
                  {form.issued_to_type === 'person' && 'Employee Name/ID *'}
                  {form.issued_to_type === 'other' && 'Reference *'}
                </label>
                <input
                  type="text"
                  value={form.issued_to_ref}
                  onChange={(e) => setForm({ ...form, issued_to_ref: e.target.value })}
                  placeholder={`Enter ${form.issued_to_type} reference...`}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Reason
                </label>
                <input
                  type="text"
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  placeholder="e.g., Job consumption, Equipment issue..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notes
                </label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                  placeholder="Optional notes..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Issue Items */}
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Items to Issue</h2>
              <button
                type="button"
                onClick={addItem}
                className="inline-flex items-center px-3 py-1.5 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Item
              </button>
            </div>

            {!form.location_id && (
              <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
                Select a location first to see available quantities
              </div>
            )}

            <div className="space-y-3">
              {issueItems.map((item, index) => {
                const available = getAvailableQty(item.catalog_item_id);
                const selectedItem = items.find((i) => i.id === item.catalog_item_id);

                return (
                  <div key={index} className="space-y-2">
                    <div className="flex gap-3 items-start">
                      <div className="flex-1">
                        <select
                          value={item.catalog_item_id}
                          onChange={(e) => updateItem(index, 'catalog_item_id', e.target.value)}
                          required
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">Select item...</option>
                          {items.map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.name} ({i.sku}) - {i.unit_of_measure}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="w-32">
                        <input
                          type="number"
                          value={item.qty_issued || ''}
                          onChange={(e) =>
                            updateItem(index, 'qty_issued', parseFloat(e.target.value) || 0)
                          }
                          placeholder="Qty"
                          min="0"
                          step="0.01"
                          max={available}
                          required
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      {issueItems.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeItem(index)}
                          className="px-3 py-2 text-red-600 hover:text-red-800"
                        >
                          ×
                        </button>
                      )}
                    </div>

                    {item.catalog_item_id && form.location_id && (
                      <div className="ml-0 pl-0 text-sm">
                        <span className="text-gray-600">Available: </span>
                        <span
                          className={`font-semibold ${
                            available > 0 ? 'text-green-600' : 'text-red-600'
                          }`}
                        >
                          {available} {selectedItem?.unit_of_measure}
                        </span>
                        {item.qty_issued > available && (
                          <span className="ml-2 text-red-600">
                            ⚠️ Insufficient stock!
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
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
              {submitting ? 'Issuing...' : 'Issue Inventory'}
            </button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
