'use client';

import { useState, useEffect, useMemo } from 'react';
import type { FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Plus, Edit, Trash2, Star, Package, ArrowLeft } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { SupplyChainRPC } from '@/lib/rpc/supply-chain';
import { InventoryRPC } from '@/lib/rpc/inventory';

interface Vendor {
  id: string;
  name: string;
  code: string;
  contact_name?: string;
  phone?: string;
  email?: string;
}

interface CatalogItem {
  id: string;
  sku: string;
  name: string;
  description?: string;
}

interface VendorItem {
  id: string;
  vendor_id: string;
  catalog_item_id: string;
  vendor_sku: string | null;
  vendor_uom?: string;
  pack_size?: number;
  is_preferred: boolean;
  unit_cost?: number;
  currency: string;
  lead_time_days?: number;
  min_order_qty?: number;
  notes?: string;
  catalog_item?: CatalogItem;
  created_at: string;
  updated_at: string;
  last_event_id: string | null;
}

export default function VendorItemsPage() {
  const params = useParams();
  const router = useRouter();
  const vendorId = params.id as string;

  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [vendorItems, setVendorItems] = useState<VendorItem[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<VendorItem | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterPreferred, setFilterPreferred] = useState<boolean | null>(null);

  const [formData, setFormData] = useState({
    catalog_item_id: '',
    vendor_sku: '',
    vendor_uom: '',
    pack_size: '1',
    unit_cost: '',
    currency: 'USD',
    lead_time_days: '',
    min_order_qty: '',
    is_preferred: false,
    notes: '',
  });

  useEffect(() => {
    if (vendorId) {
      fetchVendor();
      fetchVendorItems();
      fetchCatalogItems();
    }
  }, [vendorId]);

  const catalogItemMap = useMemo(() => {
    return new Map(catalogItems.map((item) => [item.id, item]));
  }, [catalogItems]);

  const fetchVendor = async () => {
    try {
      const data = await SupplyChainRPC.getVendorById(vendorId);
      setVendor(data as Vendor | null);
    } catch (error) {
      console.error('Error fetching vendor:', error);
    }
  };

  const fetchVendorItems = async () => {
    setLoading(true);
    try {
      const data = await SupplyChainRPC.getVendorItems(vendorId);
      setVendorItems(data as VendorItem[]);
    } catch (error) {
      console.error('Error fetching vendor items:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCatalogItems = async () => {
    try {
      const data = await InventoryRPC.getCatalogItems({ active: true });
      const normalized = data.map((item) => ({
        id: item.id,
        sku: item.sku,
        name: item.name,
        description: item.description ?? undefined,
      }));
      setCatalogItems(normalized);
    } catch (error) {
      console.error('Error fetching catalog items:', error);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    try {
      const payload = {
        vendor_id: vendorId,
        catalog_item_id: formData.catalog_item_id,
        vendor_sku: formData.vendor_sku || null,
        vendor_uom: formData.vendor_uom || null,
        pack_size: formData.pack_size ? parseFloat(formData.pack_size) : 1,
        unit_cost: formData.unit_cost ? parseFloat(formData.unit_cost) : null,
        currency: formData.currency,
        lead_time_days: formData.lead_time_days ? parseInt(formData.lead_time_days) : null,
        min_order_qty: formData.min_order_qty ? parseFloat(formData.min_order_qty) : null,
        is_preferred: formData.is_preferred,
        notes: formData.notes || null,
      };

      if (editingItem) {
        if (!editingItem.last_event_id) {
          throw new Error('Missing last_event_id for update');
        }
        await SupplyChainRPC.updateVendorItem(editingItem.id, payload, editingItem.last_event_id);
      } else {
        await SupplyChainRPC.createVendorItem(payload);
      }

      setShowModal(false);
      resetForm();
      fetchVendorItems();
    } catch (error: any) {
      alert(error.message);
    }
  };

  const handleEdit = (item: VendorItem) => {
    setEditingItem(item);
    setFormData({
      catalog_item_id: item.catalog_item_id,
      vendor_sku: item.vendor_sku,
      vendor_uom: item.vendor_uom || '',
      pack_size: item.pack_size?.toString() || '1',
      unit_cost: item.unit_cost?.toString() || '',
      currency: item.currency || 'USD',
      lead_time_days: item.lead_time_days?.toString() || '',
      min_order_qty: item.min_order_qty?.toString() || '',
      is_preferred: item.is_preferred,
      notes: item.notes || '',
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this vendor item mapping?')) return;

    try {
      const item = vendorItems.find((vendorItem) => vendorItem.id === id);
      if (!item?.last_event_id) {
        throw new Error('Missing last_event_id for delete');
      }
      await SupplyChainRPC.deleteVendorItem(id, item.last_event_id);

      fetchVendorItems();
    } catch (error: any) {
      alert(error.message);
    }
  };

  const resetForm = () => {
    setEditingItem(null);
    setFormData({
      catalog_item_id: '',
      vendor_sku: '',
      vendor_uom: '',
      pack_size: '1',
      unit_cost: '',
      currency: 'USD',
      lead_time_days: '',
      min_order_qty: '',
      is_preferred: false,
      notes: '',
    });
  };

  const filteredItems = vendorItems.filter((item) => {
    const catalogItem = catalogItemMap.get(item.catalog_item_id);
    const matchesSearch = !searchTerm ||
      item.vendor_sku?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      catalogItem?.sku?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      catalogItem?.name?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesPreferred = filterPreferred === null || item.is_preferred === filterPreferred;

    return matchesSearch && matchesPreferred;
  });

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Back Button */}
        <button
          onClick={() => router.push('/inventory/vendors')}
          className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Vendors
        </button>

        {/* Page Header */}
        <PageHeader
          title={`${vendor?.name || 'Vendor'} - Catalog Items`}
          description="Link existing catalog items to this vendor with vendor-specific pricing, SKUs, and lead times. Items must be added to your catalog first before mapping to vendors."
          actions={
            <button
              onClick={() => {
                resetForm();
                setShowModal(true);
              }}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
            >
              <Plus className="w-4 h-4" />
              Add Item
            </button>
          }
        />

        {/* Filters */}
        <div className="flex gap-4">
          <input
            type="text"
            placeholder="Search by SKU or item name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1 px-3 py-2 border rounded-md"
          />
          <select
            value={filterPreferred === null ? '' : filterPreferred.toString()}
            onChange={(e) => setFilterPreferred(e.target.value === '' ? null : e.target.value === 'true')}
            className="px-3 py-2 border rounded-md"
          >
            <option value="">All Items</option>
            <option value="true">Preferred Only</option>
            <option value="false">Non-Preferred</option>
          </select>
        </div>

      {/* Vendor Items Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading...</div>
        ) : filteredItems.length === 0 ? (
          <div className="p-8 text-center">
            <Package className="w-12 h-12 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-600">No vendor items found</p>
            <p className="text-sm text-gray-500 mt-1">Add items to this vendor's catalog to get started</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Item
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Vendor SKU
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Unit Cost
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  UOM / Pack
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Lead Time
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Min Qty
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredItems.map((item) => {
                const catalogItem = catalogItemMap.get(item.catalog_item_id);
                return (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-gray-900">
                      {catalogItem?.name || 'Unknown item'}
                    </div>
                    <div className="text-xs text-gray-500">
                      SKU: {catalogItem?.sku || '-'}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm font-mono text-gray-900">
                      {item.vendor_sku}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {item.unit_cost && (
                      <span className="text-sm text-gray-900">
                        {item.currency} ${item.unit_cost.toFixed(2)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-gray-900">
                      {item.vendor_uom || '-'}
                      {item.pack_size && item.pack_size !== 1 && (
                        <span className="text-xs text-gray-500 ml-1">
                          (x{item.pack_size})
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-gray-900">
                      {item.lead_time_days ? `${item.lead_time_days} days` : '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-gray-900">
                      {item.min_order_qty || '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {item.is_preferred && (
                      <span className="inline-flex items-center gap-1 px-2 py-1 bg-yellow-100 text-yellow-800 text-xs rounded-full">
                        <Star className="w-3 h-3 fill-current" />
                        Preferred
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => handleEdit(item)}
                        className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                        title="Edit"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="p-1 text-red-600 hover:bg-red-50 rounded"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-white">
              <h2 className="text-xl font-semibold">
                {editingItem ? 'Edit Vendor Item' : 'Add Vendor Item'}
              </h2>
              <button
                onClick={() => {
                  setShowModal(false);
                  resetForm();
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {/* Catalog Item Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Catalog Item *
                </label>
                <select
                  required
                  disabled={!!editingItem}
                  value={formData.catalog_item_id}
                  onChange={(e) => setFormData({ ...formData, catalog_item_id: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md disabled:bg-gray-100"
                >
                  <option value="">Select an item...</option>
                  {catalogItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.sku} - {item.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Vendor SKU */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Vendor SKU *
                </label>
                <input
                  type="text"
                  required
                  value={formData.vendor_sku}
                  onChange={(e) => setFormData({ ...formData, vendor_sku: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md"
                  placeholder="Vendor's part number"
                />
              </div>

              {/* Row: Unit Cost, Currency */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Unit Cost
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.unit_cost}
                    onChange={(e) => setFormData({ ...formData, unit_cost: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Currency
                  </label>
                  <select
                    value={formData.currency}
                    onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md"
                  >
                    <option value="USD">USD</option>
                    <option value="CAD">CAD</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                  </select>
                </div>
              </div>

              {/* Row: UOM, Pack Size */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Vendor UOM
                  </label>
                  <input
                    type="text"
                    value={formData.vendor_uom}
                    onChange={(e) => setFormData({ ...formData, vendor_uom: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md"
                    placeholder="e.g., BOX, PALLET"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Pack Size
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.pack_size}
                    onChange={(e) => setFormData({ ...formData, pack_size: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md"
                    placeholder="1"
                  />
                </div>
              </div>

              {/* Row: Lead Time, Min Order Qty */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Lead Time (days)
                  </label>
                  <input
                    type="number"
                    value={formData.lead_time_days}
                    onChange={(e) => setFormData({ ...formData, lead_time_days: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md"
                    placeholder="e.g., 7"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Minimum Order Qty
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.min_order_qty}
                    onChange={(e) => setFormData({ ...formData, min_order_qty: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md"
                    placeholder="e.g., 10"
                  />
                </div>
              </div>

              {/* Preferred Vendor Checkbox */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_preferred"
                  checked={formData.is_preferred}
                  onChange={(e) => setFormData({ ...formData, is_preferred: e.target.checked })}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <label htmlFor="is_preferred" className="text-sm font-medium text-gray-700 flex items-center gap-1">
                  <Star className="w-4 h-4 text-yellow-500" />
                  Mark as preferred vendor for this item
                </label>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notes
                </label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md"
                  rows={3}
                  placeholder="Additional notes..."
                />
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    resetForm();
                  }}
                  className="flex-1 px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  {editingItem ? 'Update' : 'Add'} Item
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
