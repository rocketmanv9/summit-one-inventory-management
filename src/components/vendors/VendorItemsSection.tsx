'use client';

/**
 * First-class Items panel for the vendor hub. Shows everything a vendor
 * supplies with vendor SKU, pack size, unit cost, lead time, min order qty and
 * a preferred badge, plus a one-click "Order this" that deep-links to PO create
 * prefilled with this vendor + item. Add/edit inline so the vendor page is where
 * you maintain their catalog. Reuses SupplyChainRPC — no new API surface.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import {
  ArrowDown,
  ArrowUp,
  Edit,
  PackageSearch,
  Plus,
  ShoppingCart,
  Star,
  Trash2,
} from 'lucide-react';
import { AppError } from '@rocketmanv9/chassis/errors';
import { SupplyChainRPC, type VendorItemDetailed } from '@/lib/rpc/supply-chain';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { useUOMLabelMap, useUOMTerms } from '@/hooks/useGVTerms';

interface CatalogItemOption {
  id: string;
  sku: string;
  name: string;
}

type SortKey = 'name' | 'cost';

const EMPTY_FORM = {
  catalog_item_id: '',
  vendor_sku: '',
  vendor_uom_term_id: '',
  pack_size: '1',
  unit_cost: '',
  currency: 'USD',
  lead_time_days: '',
  min_order_qty: '',
  is_preferred: false,
  notes: '',
};

export function VendorItemsSection({ vendorId }: { vendorId: string }) {
  const uomLabels = useUOMLabelMap();
  const { terms: uomTerms, loading: uomLoading } = useUOMTerms();

  const [items, setItems] = useState<VendorItemDetailed[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogItemOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortAsc, setSortAsc] = useState(true);

  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<VendorItemDetailed | null>(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const loadItems = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const data = await SupplyChainRPC.getVendorItemsDetailed(vendorId);
      setItems(data);
    } catch (err: any) {
      console.error('Error fetching vendor items:', err);
      setLoadError(err?.message || 'Failed to load items');
    } finally {
      setLoading(false);
    }
  }, [vendorId]);

  useEffect(() => {
    if (vendorId) loadItems();
  }, [vendorId, loadItems]);

  // Catalog items only needed to populate the add/edit picker — load lazily
  // the first time the modal opens so the tab itself paints fast.
  const ensureCatalog = useCallback(async () => {
    if (catalogItems.length) return;
    try {
      const data = await InventoryRPC.getCatalogItems({ active: true });
      setCatalogItems(data.map((i) => ({ id: i.id, sku: i.sku, name: i.name })));
    } catch (err) {
      console.error('Error fetching catalog items:', err);
    }
  }, [catalogItems.length]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = items.filter((it) => {
      if (!q) return true;
      return (
        it.catalog_item?.name?.toLowerCase().includes(q) ||
        it.catalog_item?.sku?.toLowerCase().includes(q) ||
        it.vendor_sku?.toLowerCase().includes(q)
      );
    });
    const dir = sortAsc ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sortKey === 'cost') {
        const ac = a.unit_cost ?? Number.POSITIVE_INFINITY;
        const bc = b.unit_cost ?? Number.POSITIVE_INFINITY;
        if (ac !== bc) return (ac - bc) * dir;
      }
      return (a.catalog_item?.name || '').localeCompare(b.catalog_item?.name || '') * dir;
    });
  }, [items, search, sortKey, sortAsc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc((v) => !v);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const openAdd = async () => {
    setEditingItem(null);
    setFormData(EMPTY_FORM);
    setFormError('');
    setShowModal(true);
    await ensureCatalog();
  };

  const openEdit = async (item: VendorItemDetailed) => {
    setEditingItem(item);
    setFormData({
      catalog_item_id: item.catalog_item_id,
      vendor_sku: item.vendor_sku || '',
      vendor_uom_term_id: item.vendor_uom_term_id || '',
      pack_size: item.pack_size?.toString() || '1',
      unit_cost: item.unit_cost?.toString() || '',
      currency: item.currency || 'USD',
      lead_time_days: item.lead_time_days?.toString() || '',
      min_order_qty: item.min_order_qty?.toString() || '',
      is_preferred: !!item.is_preferred,
      notes: item.notes || '',
    });
    setFormError('');
    setShowModal(true);
    await ensureCatalog();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      const payload = {
        vendor_id: vendorId,
        catalog_item_id: formData.catalog_item_id,
        vendor_sku: formData.vendor_sku || '',
        vendor_uom_term_id: formData.vendor_uom_term_id || null,
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
          throw AppError.badRequest('Missing last_event_id for update');
        }
        await SupplyChainRPC.updateVendorItem(editingItem.id, payload, editingItem.last_event_id);
      } else {
        await SupplyChainRPC.createVendorItem(payload);
      }

      setShowModal(false);
      setFormData(EMPTY_FORM);
      setEditingItem(null);
      await loadItems();
    } catch (err: any) {
      setFormError(err?.message || 'Failed to save item');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item: VendorItemDetailed) => {
    if (!confirm(`Unlink "${item.catalog_item?.name || 'this item'}" from the vendor?`)) return;
    try {
      if (!item.last_event_id) {
        throw AppError.badRequest('Missing last_event_id for delete');
      }
      await SupplyChainRPC.deleteVendorItem(item.id, item.last_event_id);
      await loadItems();
    } catch (err: any) {
      alert(err?.message || 'Failed to unlink item');
    }
  };

  return (
    <div className="rounded-lg border bg-card p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Items ({items.length})
        </h3>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Link item
        </button>
      </div>

      {items.length > 0 && (
        <input
          type="text"
          placeholder="Search this vendor's items by name or SKU..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-2 border rounded-md text-sm"
        />
      )}

      {loading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Loading items...</div>
      ) : loadError ? (
        <div className="py-10 text-center text-sm text-red-600">{loadError}</div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed py-10 px-6 text-center">
          <PackageSearch className="h-10 w-10 text-muted-foreground/60 mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground">No items linked yet</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
            Link items so purchase orders can prefill this vendor&apos;s pricing, SKUs, and lead
            times.
          </p>
          <button
            onClick={openAdd}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Link the first item
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">
          No items match &ldquo;{search}&rdquo;.
        </div>
      ) : (
        <div className="overflow-x-auto -mx-6">
          <table className="w-full text-sm">
            <thead className="border-y bg-muted/40">
              <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-6 py-2 font-medium">
                  <button
                    onClick={() => toggleSort('name')}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    Item
                    {sortKey === 'name' &&
                      (sortAsc ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                  </button>
                </th>
                <th className="px-3 py-2 font-medium">Vendor SKU</th>
                <th className="px-3 py-2 font-medium">Pack</th>
                <th className="px-3 py-2 font-medium">
                  <button
                    onClick={() => toggleSort('cost')}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    Unit Cost
                    {sortKey === 'cost' &&
                      (sortAsc ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                  </button>
                </th>
                <th className="px-3 py-2 font-medium">Lead Time</th>
                <th className="px-3 py-2 font-medium">Min Qty</th>
                <th className="px-3 py-2 font-medium"></th>
                <th className="px-6 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((item) => (
                <tr key={item.id} className="hover:bg-muted/30">
                  <td className="px-6 py-3">
                    {item.catalog_item ? (
                      <Link
                        href={`/inventory/items/${item.catalog_item.id}`}
                        className="font-medium text-foreground hover:text-primary hover:underline"
                      >
                        {item.catalog_item.name}
                      </Link>
                    ) : (
                      <span className="font-medium text-muted-foreground">Unknown item</span>
                    )}
                    <div className="text-xs text-muted-foreground">
                      SKU: {item.catalog_item?.sku || '-'}
                    </div>
                  </td>
                  <td className="px-3 py-3 font-mono text-xs">{item.vendor_sku || '-'}</td>
                  <td className="px-3 py-3">
                    {item.vendor_uom_term_id
                      ? uomLabels[item.vendor_uom_term_id] || item.vendor_uom_term_id
                      : '-'}
                    {item.pack_size && item.pack_size !== 1 && (
                      <span className="text-xs text-muted-foreground ml-1">×{item.pack_size}</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {item.unit_cost != null
                      ? `${item.currency || 'USD'} $${Number(item.unit_cost).toFixed(2)}`
                      : '-'}
                  </td>
                  <td className="px-3 py-3">
                    {item.lead_time_days != null ? `${item.lead_time_days} days` : '-'}
                  </td>
                  <td className="px-3 py-3">{item.min_order_qty ?? '-'}</td>
                  <td className="px-3 py-3">
                    {item.is_preferred && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-yellow-100 text-yellow-800 text-xs rounded-full">
                        <Star className="h-3 w-3 fill-current" />
                        Preferred
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        href={`/inventory/purchasing/create?vendor=${vendorId}&item_id=${item.catalog_item_id}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
                        title="Start a PO for this item from this vendor"
                      >
                        <ShoppingCart className="h-3.5 w-3.5" />
                        Order this
                      </Link>
                      <button
                        onClick={() => openEdit(item)}
                        className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"
                        title="Edit"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(item)}
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                        title="Unlink"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-white">
              <h2 className="text-xl font-semibold">
                {editingItem ? 'Edit Vendor Item' : 'Link Item to Vendor'}
              </h2>
              <button
                onClick={() => {
                  setShowModal(false);
                  setEditingItem(null);
                  setFormData(EMPTY_FORM);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {formError && (
                <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                  {formError}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Catalog Item *</label>
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

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Vendor SKU</label>
                <input
                  type="text"
                  value={formData.vendor_sku}
                  onChange={(e) => setFormData({ ...formData, vendor_sku: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md"
                  placeholder="Vendor's part number"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Unit Cost</label>
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
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

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Vendor UOM</label>
                  <select
                    value={formData.vendor_uom_term_id}
                    onChange={(e) => setFormData({ ...formData, vendor_uom_term_id: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md"
                  >
                    <option value="">Select UOM...</option>
                    {uomLoading ? (
                      <option disabled>Loading...</option>
                    ) : (
                      uomTerms.map((t) => (
                        <option key={t.term_id} value={t.term_id}>
                          {t.label}
                        </option>
                      ))
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Pack Size</label>
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

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="vis_is_preferred"
                  checked={formData.is_preferred}
                  onChange={(e) => setFormData({ ...formData, is_preferred: e.target.checked })}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <label
                  htmlFor="vis_is_preferred"
                  className="text-sm font-medium text-gray-700 flex items-center gap-1"
                >
                  <Star className="w-4 h-4 text-yellow-500" />
                  Mark as preferred vendor for this item
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md"
                  rows={3}
                  placeholder="Additional notes..."
                />
              </div>

              <div className="flex gap-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setEditingItem(null);
                    setFormData(EMPTY_FORM);
                  }}
                  className="flex-1 px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-60"
                >
                  {saving ? 'Saving...' : editingItem ? 'Update Item' : 'Link Item'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
