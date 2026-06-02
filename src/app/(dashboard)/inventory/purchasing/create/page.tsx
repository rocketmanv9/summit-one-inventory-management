'use client';

import { AppError } from '@rocketmanv9/chassis/errors';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { SupplyChainRPC } from '@/lib/rpc/supply-chain';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { useUOMLabelMap } from '@/hooks/useGVTerms';
import { Plus, AlertCircle, Check } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface Vendor {
  id: string;
  name: string;
  code: string | null;
}

interface Location {
  id: string;
  name: string;
  location_type?: { name: string } | null;
}

interface CatalogItem {
  id: string;
  name: string;
  sku: string;
  uom_term_id: string | null;
  is_parent?: boolean;
}

interface POLine {
  catalog_item_id: string;
  qty_ordered: number;
  unit_cost: number;
}

export default function CreatePurchaseOrderPage() {
  const router = useRouter();
  const uomLabels = useUOMLabelMap();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const [form, setForm] = useState({
    vendor_id: '',
    po_number: '',
    delivery_location_id: '',
    expected_delivery_date: '',
    notes: '',
  });

  const [lines, setLines] = useState<POLine[]>([
    { catalog_item_id: '', qty_ordered: 0, unit_cost: 0 },
  ]);

  // Track parent selection per line + cached variants per parent
  const [lineParentIds, setLineParentIds] = useState<Record<number, string>>({});
  const [variantsByParent, setVariantsByParent] = useState<Record<string, CatalogItem[]>>({});

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [vendorsData, locationsData, itemsData] = await Promise.all([
        SupplyChainRPC.getVendors(),
        InventoryRPC.getLocations({ active: true }),
        InventoryRPC.getCatalogItems({ active: true }),
      ]);
      setVendors(vendorsData);
      setLocations(locationsData);
      setItems(itemsData);

      // Prefill from query params (e.g. the "Create PO"/"Reorder" buttons on the
      // alerts and item pages pass item_id, qty, location_id, and vendor).
      const sp = new URLSearchParams(window.location.search);
      const itemId = sp.get('item_id');
      const qty = sp.get('qty');
      const locId = sp.get('location_id');
      const vendorParam = sp.get('vendor');

      setForm((prev) => ({
        ...prev,
        delivery_location_id:
          locId && locationsData.some((l) => l.id === locId) ? locId : prev.delivery_location_id,
        vendor_id:
          (vendorParam &&
            (vendorsData.find((v) => v.id === vendorParam) ??
              vendorsData.find((v) => v.code === vendorParam))?.id) ||
          prev.vendor_id,
      }));

      if (itemId && itemsData.some((i) => i.id === itemId)) {
        setLines([{ catalog_item_id: itemId, qty_ordered: qty ? parseFloat(qty) || 0 : 0, unit_cost: 0 }]);
      }
    } catch (err: any) {
      setError(`Failed to load data: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const loadVariants = async (parentId: string) => {
    if (variantsByParent[parentId]) return; // already cached
    try {
      const variants = await InventoryRPC.getCatalogItems({
        active: true,
        parent_item_id: parentId,
        exclude_variants: false,
      });
      setVariantsByParent(prev => ({ ...prev, [parentId]: variants }));
    } catch (err: any) {
      console.error('Failed to load variants:', err);
    }
  };

  const handleItemSelect = (index: number, itemId: string) => {
    const item = items.find(i => i.id === itemId);
    if (item?.is_parent) {
      // Parent selected — store parent selection, clear catalog_item_id until variant is chosen
      setLineParentIds(prev => ({ ...prev, [index]: itemId }));
      updateLine(index, 'catalog_item_id', '');
      loadVariants(itemId);
    } else {
      // Standalone item — set directly
      setLineParentIds(prev => {
        const next = { ...prev };
        delete next[index];
        return next;
      });
      updateLine(index, 'catalog_item_id', itemId);
    }
  };

  const addLine = () => {
    setLines([...lines, { catalog_item_id: '', qty_ordered: 0, unit_cost: 0 }]);
  };

  const removeLine = (index: number) => {
    setLines(lines.filter((_, i) => i !== index));
  };

  const updateLine = (index: number, field: keyof POLine, value: any) => {
    const newLines = [...lines];
    newLines[index] = { ...newLines[index], [field]: value };
    setLines(newLines);
  };

  const calculateTotal = () => {
    return lines.reduce((sum, line) => sum + line.qty_ordered * line.unit_cost, 0);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    setSuccess(false);

    try {
      // Validate
      if (!form.vendor_id) {
        throw AppError.badRequest('Please select a vendor');
      }

      if (!form.delivery_location_id) {
        throw AppError.badRequest('Please select a delivery location');
      }

      const validLines = lines.filter(
        (line) =>
          line.catalog_item_id && line.qty_ordered > 0 && line.unit_cost >= 0
      );

      if (validLines.length === 0) {
        throw AppError.badRequest('Please add at least one line item');
      }

      // Create PO using RPC
      const result = await SupplyChainRPC.createPurchaseOrder({
        vendor_id: form.vendor_id,
        po_number: form.po_number || undefined,
        delivery_location_id: form.delivery_location_id,
        lines: validLines,
        needed_by_date: form.expected_delivery_date || undefined,
        notes: form.notes || undefined,
      });

      setSuccess(true);
      setTimeout(() => {
        router.push('/inventory/purchasing');
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
          <h1 className="text-3xl font-bold text-gray-900">Create Purchase Order</h1>
          <p className="mt-2 text-sm text-gray-600">
            Add the vendor, delivery location, and line items, then create the order.
          </p>
        </div>

        {/* Success Message */}
        {success && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
            <Check className="h-5 w-5 text-green-600" />
            <span className="text-green-800">
              Purchase Order created successfully! Redirecting...
            </span>
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
          {/* PO Header */}
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <h2 className="text-lg font-semibold mb-4">Purchase Order Information</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Vendor *
                </label>
                <select
                  value={form.vendor_id}
                  onChange={(e) => setForm({ ...form, vendor_id: e.target.value })}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select vendor...</option>
                  {vendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {vendor.name} ({vendor.code ?? 'No code'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  PO Number (optional)
                </label>
                <input
                  type="text"
                  value={form.po_number}
                  onChange={(e) => setForm({ ...form, po_number: e.target.value })}
                  placeholder="Auto-generated if left blank"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Delivery Location *
                </label>
                <select
                  value={form.delivery_location_id}
                  onChange={(e) =>
                    setForm({ ...form, delivery_location_id: e.target.value })
                  }
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select location...</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name} ({loc.location_type?.name || 'Location'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Expected Delivery Date <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  type="date"
                  value={form.expected_delivery_date}
                  onChange={(e) =>
                    setForm({ ...form, expected_delivery_date: e.target.value })
                  }
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

          {/* PO Lines */}
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Line Items</h2>
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
              {lines.map((line, index) => {
                const parentId = lineParentIds[index];
                const selectedItem = parentId
                  ? (variantsByParent[parentId] || []).find(v => v.id === line.catalog_item_id)
                  : items.find((i) => i.id === line.catalog_item_id);
                const lineTotal = line.qty_ordered * line.unit_cost;

                return (
                  <div key={index} className="space-y-2">
                    <div className="flex gap-3 items-start">
                      <div className="flex-1 space-y-2">
                        <select
                          value={parentId || line.catalog_item_id}
                          onChange={(e) => handleItemSelect(index, e.target.value)}
                          required
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">Select item...</option>
                          {items.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name} ({item.sku}){item.is_parent ? ' [has variants]' : ''} - {uomLabels[item.uom_term_id || ''] || item.uom_term_id || 'N/A'}
                            </option>
                          ))}
                        </select>

                        {/* Variant sub-dropdown for parent items */}
                        {parentId && (
                          <select
                            value={line.catalog_item_id}
                            onChange={(e) => updateLine(index, 'catalog_item_id', e.target.value)}
                            required
                            className="w-full px-3 py-2 border border-violet-300 rounded-md bg-violet-50 focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm"
                          >
                            <option value="">Select variant...</option>
                            {(variantsByParent[parentId] || []).map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.name} ({v.sku})
                              </option>
                            ))}
                            {!variantsByParent[parentId] && (
                              <option value="" disabled>Loading variants...</option>
                            )}
                          </select>
                        )}
                      </div>

                      <div className="w-24">
                        <input
                          type="number"
                          value={line.qty_ordered || ''}
                          onChange={(e) =>
                            updateLine(
                              index,
                              'qty_ordered',
                              parseFloat(e.target.value) || 0
                            )
                          }
                          placeholder="Qty"
                          min="0"
                          step="0.01"
                          required
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      <div className="w-32">
                        <input
                          type="number"
                          value={line.unit_cost || ''}
                          onChange={(e) =>
                            updateLine(index, 'unit_cost', parseFloat(e.target.value) || 0)
                          }
                          placeholder="Unit Cost"
                          min="0"
                          step="0.01"
                          required
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      <div className="w-32">
                        <div className="px-3 py-2 bg-gray-100 border border-gray-300 rounded-md text-sm font-medium text-right">
                          ${lineTotal.toFixed(2)}
                        </div>
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

                    {selectedItem && (
                      <div className="ml-0 text-sm text-gray-600">
                        Unit: {uomLabels[selectedItem.uom_term_id || ''] || selectedItem.uom_term_id || 'N/A'}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Total */}
            <div className="mt-4 pt-4 border-t border-gray-200">
              <div className="flex justify-between items-center">
                <span className="text-lg font-semibold text-gray-900">Total:</span>
                <span className="text-2xl font-bold text-blue-600">
                  ${calculateTotal().toFixed(2)}
                </span>
              </div>
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
              {submitting ? 'Creating...' : 'Create Purchase Order'}
            </button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
