'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/FilterBar';
import { StatusChip } from '@/components/ui/StatusChip';
import { InventoryRPC } from '@/lib/rpc/inventory';
import type { Database } from 'types/supabase';

type CatalogItemRow = Database['inventory']['Tables']['catalog_items']['Row'];
type ItemCategoryRow = Database['inventory']['Tables']['item_categories']['Row'];
type InventoryLevelRow = Database['inventory']['Tables']['inventory_levels']['Row'];
type LocationRow = Database['inventory']['Tables']['locations']['Row'];
type SkuSettingsRow = Database['inventory']['Tables']['sku_settings']['Row'];

type CatalogItem = CatalogItemRow & {
  item_categories?: Pick<ItemCategoryRow, 'name'> | null;
};
type Category = ItemCategoryRow;
type Location = LocationRow;
type InventoryLevel = Pick<InventoryLevelRow, 'id' | 'location_id' | 'current_stock' | 'reorder_point' | 'target_stock'>;
type TrackingMode = CatalogItemRow['tracking_mode'];
type SkuSettings = Pick<SkuSettingsRow, 'separator' | 'next_sequence'>;

export default function ItemsPage() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingItem, setEditingItem] = useState<CatalogItem | undefined>();

  useEffect(() => {
    fetchItems();
  }, [filters]);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const data = await InventoryRPC.getCatalogItems({
        active: filters.active_only === 'true' ? true : undefined,
        tracking_mode: filters.tracking_mode || undefined,
        search: filters.search || undefined,
      });
      setItems(data);
    } catch (error) {
      console.error('Error fetching items:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleManageCategories = () => {
    window.location.href = '/inventory/categories';
  };

  const handleDelete = async (itemId: string, itemName: string, lastEventId: string | null) => {
    if (!confirm(`Are you sure you want to delete "${itemName}"?`)) {
      return;
    }

    try {
      if (!lastEventId) {
        throw new Error('Missing last_event_id for this item. Please refresh and try again.');
      }

      await InventoryRPC.deleteCatalogItem(itemId, lastEventId);

      fetchItems(); // Refresh the list
    } catch (error: any) {
      alert(`Error: ${error.message}`);
    }
  };

  const columns = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      render: (row: CatalogItem) => (
        <div>
          <div className="font-medium">{row.name}</div>
          {row.description && (
            <div className="text-xs text-muted-foreground truncate max-w-xs">
              {row.description}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'sku',
      header: 'SKU',
      sortable: true,
      render: (row: CatalogItem) => (
        <span className="font-mono text-sm">{row.sku}</span>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      sortable: true,
      render: (row: CatalogItem) => row.item_categories?.name || '-',
    },
    {
      key: 'unit_of_measure',
      header: 'UOM',
      sortable: true,
    },
    {
      key: 'tracking_mode',
      header: 'Tracking',
      render: (row: CatalogItem) => (
        <StatusChip status={row.tracking_mode} />
      ),
    },
    {
      key: 'reorder_point',
      header: 'Reorder Point',
      className: 'text-right font-mono',
      render: (row: CatalogItem) => row.reorder_point?.toLocaleString() ?? '-',
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: CatalogItem) => (
        <StatusChip status={row.active ? 'active' : 'inactive'} />
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      className: 'text-right',
      render: (row: CatalogItem) => (
        <div className="flex gap-2 justify-end">
          <button
            onClick={() => {
              setEditingItem(row);
              setShowCreateModal(true);
            }}
            className="text-blue-600 hover:text-blue-800 px-3 py-1 text-sm font-medium"
          >
            Edit
          </button>
          <button
            onClick={() => handleDelete(row.id, row.name, row.last_event_id ?? null)}
            className="text-red-600 hover:text-red-800 px-3 py-1 text-sm font-medium"
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  const filterConfig = [
    {
      key: 'search',
      label: 'Search',
      type: 'search' as const,
      placeholder: 'Name or SKU...',
    },
    {
      key: 'tracking_mode',
      label: 'Tracking',
      type: 'select' as const,
      options: [
        { value: 'stock', label: 'Stock' },
        { value: 'serialized', label: 'Serialized' },
        { value: 'both', label: 'Both' },
      ],
    },
  ];

  const filteredItems = items.filter((item) => {
    if (filters.search) {
      const search = filters.search.toLowerCase();
      if (!item.name.toLowerCase().includes(search) && !item.sku.toLowerCase().includes(search)) {
        return false;
      }
    }
    if (filters.tracking_mode && item.tracking_mode !== filters.tracking_mode) {
      return false;
    }
    return true;
  });

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Catalog Items"
          description="Manage your inventory catalog. Example: Define items like 'Hot Mix Asphalt (HMA)', 'Ready-Mix Concrete 3000 PSI', 'Rebar #4', 'Aggregate Base', or 'Diesel Fuel' - each with SKUs, units (tons, yards, gallons), and categories."
          actions={
            <div className="flex gap-3">
              <button
                onClick={handleManageCategories}
                className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
              >
                Manage Categories
              </button>
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
              >
                + Add Item
              </button>
            </div>
          }
        />

        <FilterBar
          filters={filterConfig}
          values={filters}
          onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
          onClear={() => setFilters({})}
        />

        <DataTable
          data={filteredItems}
          columns={columns}
          loading={loading}
          emptyMessage="No items found"
          rowKey={(row) => row.id}
        />

        {showCreateModal && (
          <CreateItemModal
            item={editingItem}
            onClose={() => {
              setShowCreateModal(false);
              setEditingItem(undefined);
            }}
            onCreated={() => {
              setShowCreateModal(false);
              setEditingItem(undefined);
              fetchItems();
            }}
          />
        )}
      </div>
    </AppShell>
  );
}

function CreateItemModal({ 
  onClose, 
  onCreated,
  item 
}: { 
  onClose: () => void; 
  onCreated: () => void;
  item?: CatalogItem;
}) {
  const isEditing = !!item;
  const [form, setForm] = useState<{
    name: string;
    sku: string;
    base_sku: string;
    description: string;
    category_id: string;
    unit_of_measure: string;
    tracking_mode: TrackingMode;
    reorder_point: string;
  }>({
    name: item?.name || '',
    sku: item?.sku || '',
    base_sku: item?.base_sku || '',
    description: item?.description || '',
    category_id: item?.category_id || '',
    unit_of_measure: item?.unit_of_measure || 'EA',
    tracking_mode: item?.tracking_mode || 'stock',
    reorder_point: item?.reorder_point?.toString() || '',
  });
  const [categories, setCategories] = useState<Category[]>([]);
  const [skuSettings, setSkuSettings] = useState<SkuSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [locations, setLocations] = useState<Location[]>([]);
  const [levels, setLevels] = useState<InventoryLevel[]>([]);
  const [levelsSaving, setLevelsSaving] = useState(false);
  const handleAddCategory = () => {
    window.open('/inventory/categories', '_blank');
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  useEffect(() => {
    if (!form.category_id) {
      setSkuSettings(null);
      return;
    }

    async function loadSkuSettings() {
      try {
        const data = await InventoryRPC.getSkuSettings(form.category_id);
        if (data) {
          setSkuSettings({
            separator: data.separator || '-',
            next_sequence: data.next_sequence ?? 1,
          });
          return;
        }

        setSkuSettings({ separator: '-', next_sequence: 1 });
      } catch (err) {
        console.error('Error loading SKU settings:', err);
      }
    }

    loadSkuSettings();
  }, [form.category_id]);

  useEffect(() => {
    if (!isEditing || !item?.id) return;

    async function loadLocationsAndLevels() {
      try {
        const [locsResult, levelsResult] = await Promise.all([
          InventoryRPC.getLocations(),
          InventoryRPC.getInventoryLevelsForItem(item.id),
        ]);

        setLocations((locsResult || []) as Location[]);

        const rows = (levelsResult || []).map((row) => ({
          id: row.id,
          location_id: row.location_id,
          current_stock: Number(row.current_stock ?? 0),
          reorder_point: row.reorder_point === null ? null : Number(row.reorder_point),
          target_stock: row.target_stock === null ? null : Number(row.target_stock),
        }));
        setLevels(rows);
      } catch (err) {
        console.error('Error loading location stock levels:', err);
      }
    }

    loadLocationsAndLevels();
  }, [isEditing, item?.id]);

  useEffect(() => {
    if (isEditing) return;

    const category = categories.find((cat) => cat.id === form.category_id);
    if (!category) return;

    const categoryMode = category.sku_mode || 'sequential';

    if (categoryMode === 'manual') {
      return;
    }

    const separator = skuSettings?.separator || '-';
    const prefix = category.sku_prefix ? category.sku_prefix.toUpperCase() : '';
    const parent = categories.find((cat) => cat.id === category.parent_category_id);
    const parentPrefix = parent?.sku_prefix ? parent.sku_prefix.toUpperCase() : '';

    if (categoryMode === 'sequential') {
      const next = skuSettings?.next_sequence ?? 1;
      const padded = String(next).padStart(3, '0');
      const sku = prefix ? `${prefix}${separator}${padded}` : padded;
      setForm((prev) => ({ ...prev, base_sku: padded, sku }));
      return;
    }

    if (categoryMode === 'attribute_based') {
      const next = skuSettings?.next_sequence ?? 1;
      const padded = form.base_sku ? form.base_sku.toUpperCase() : String(next).padStart(3, '0');
      const parts = [parentPrefix, prefix, padded].filter(Boolean);
      const sku = parts.join(separator);
      setForm((prev) => ({ ...prev, base_sku: padded, sku }));
    }
  }, [form.category_id, form.base_sku, skuSettings, categories, isEditing]);

  const buildSkuForCategory = () => {
    const category = categories.find((cat) => cat.id === form.category_id);
    if (!category) return form.sku;
    const categoryMode = category.sku_mode || 'sequential';
    if (categoryMode === 'manual') return form.sku;

    const separator = skuSettings?.separator || '-';
    const prefix = category.sku_prefix ? category.sku_prefix.toUpperCase() : '';
    const parent = categories.find((cat) => cat.id === category.parent_category_id);
    const parentPrefix = parent?.sku_prefix ? parent.sku_prefix.toUpperCase() : '';

    if (categoryMode === 'sequential') {
      const next = skuSettings?.next_sequence ?? 1;
      const padded = String(next).padStart(3, '0');
      return prefix ? `${prefix}${separator}${padded}` : padded;
    }

    if (categoryMode === 'attribute_based') {
      const next = skuSettings?.next_sequence ?? 1;
      const baseSku = form.base_sku?.toUpperCase() || String(next).padStart(3, '0');
      const parts = [parentPrefix, prefix, baseSku].filter(Boolean);
      return parts.join(separator);
    }

    return form.sku;
  };

  const fetchCategories = async () => {
    try {
      const data = await InventoryRPC.getItemCategories();
      setCategories(data || []);
    } catch (err) {
      console.error('Error fetching categories:', err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      const category = categories.find((cat) => cat.id === form.category_id);
      const categoryMode = category?.sku_mode || 'sequential';
      const autoGeneratedBaseSku =
        categoryMode === 'attribute_based' && !form.base_sku
          ? String(skuSettings?.next_sequence ?? 1).padStart(3, '0')
          : form.base_sku;
      const autoSku = buildSkuForCategory();

      const payload = {
        name: form.name,
        sku: autoSku,
        description: form.description || null,
        category_id: form.category_id || null,
        unit_of_measure: form.unit_of_measure,
        tracking_mode: form.tracking_mode,
        reorder_point: form.reorder_point ? Number(form.reorder_point) : null,
        base_sku: autoGeneratedBaseSku || null,
      };

      if (isEditing && item) {
        if (!item.last_event_id) {
          throw new Error('Missing last_event_id for this item. Please refresh and try again.');
        }

        await InventoryRPC.updateCatalogItem(item.id, payload, item.last_event_id);
      } else {
        await InventoryRPC.createCatalogItem({
          ...payload,
          last_event_id: crypto.randomUUID(),
        });
      }

      if (!isEditing) {
        if (categoryMode === 'sequential' || categoryMode === 'attribute_based') {
          const nextSequence = (skuSettings?.next_sequence ?? 1) + 1;
          await InventoryRPC.upsertSkuSettings({
            category_id: form.category_id,
            separator: skuSettings?.separator || '-',
            next_sequence: nextSequence,
          });
        }
      }

      onCreated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleLevelChange = (locationId: string, field: 'reorder_point' | 'target_stock', value: string) => {
    setLevels((prev) => {
      const next = [...prev];
      const existing = next.find((level) => level.location_id === locationId);
      const numeric = value === '' ? null : Number(value);
      if (existing) {
        existing[field] = numeric;
      } else {
        next.push({
          location_id: locationId,
          current_stock: 0,
          reorder_point: field === 'reorder_point' ? numeric : null,
          target_stock: field === 'target_stock' ? numeric : null,
        });
      }
      return next;
    });
  };

  const saveLevels = async () => {
    if (!item?.id) return;
    setLevelsSaving(true);
    try {
      const payload = levels.map((level) => ({
        catalog_item_id: item.id,
        location_id: level.location_id,
        current_stock: level.current_stock || 0,
        reorder_point: level.reorder_point,
        target_stock: level.target_stock,
      }));

      await InventoryRPC.upsertInventoryLevels(payload);
    } catch (err) {
      console.error('Error saving inventory levels:', err);
    } finally {
      setLevelsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold">Create Catalog Item</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">
              {error}
            </div>
          )}

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
            <label className="block text-sm font-medium mb-1">SKU *</label>
            <input
              type="text"
              value={form.sku}
              onChange={(e) => setForm({ ...form, sku: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono"
              required
              readOnly={!isEditing && categories.find((cat) => cat.id === form.category_id)?.sku_mode !== 'manual'}
            />
            {!isEditing && categories.find((cat) => cat.id === form.category_id)?.sku_mode !== 'manual' && (
              <p className="mt-2 text-xs text-muted-foreground">
                SKU is auto-generated from the category settings.
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Base SKU</label>
            <input
              type="text"
              value={form.base_sku}
              onChange={(e) => setForm({ ...form, base_sku: e.target.value.toUpperCase() })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono"
              placeholder="e.g., 001 or MAC"
              readOnly={!isEditing && categories.find((cat) => cat.id === form.category_id)?.sku_mode === 'sequential'}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Used for attribute-based SKU assembly. Sequential mode auto-fills this value.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              rows={2}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium">Category</label>
              <button
                type="button"
                onClick={handleAddCategory}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium"
              >
                Add category
              </button>
            </div>
            <select
              value={form.category_id}
              onChange={(e) => setForm({ ...form, category_id: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">-- Select Category (Optional) --</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-muted-foreground">
              Can't find a match? Add a new category in a new tab.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Unit of Measure</label>
              <select
                value={form.unit_of_measure}
                onChange={(e) => setForm({ ...form, unit_of_measure: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="EA">Each</option>
                <option value="BOX">Box</option>
                <option value="CASE">Case</option>
                <option value="LB">Pound</option>
                <option value="KG">Kilogram</option>
                <option value="GAL">Gallon</option>
                <option value="LTR">Liter</option>
                <option value="FT">Foot</option>
                <option value="M">Meter</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Tracking Mode</label>
              <select
                value={form.tracking_mode}
                onChange={(e) => setForm({ ...form, tracking_mode: e.target.value as TrackingMode })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="stock">Stock</option>
                <option value="serialized">Serialized</option>
                <option value="both">Both</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Reorder Point</label>
            <input
              type="number"
              value={form.reorder_point}
              onChange={(e) => setForm({ ...form, reorder_point: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              min="0"
            />
          </div>

          {isEditing && (
            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h4 className="text-sm font-semibold">Location Stock Management</h4>
                  <p className="text-xs text-muted-foreground">
                    Set reorder and target stock per location. Warnings appear when below threshold.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={saveLevels}
                  disabled={levelsSaving}
                  className="px-3 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {levelsSaving ? 'Saving...' : 'Save Levels'}
                </button>
              </div>

              <div className="space-y-3">
                {locations.map((loc) => {
                  const level = levels.find((row) => row.location_id === loc.id);
                  const currentStock = level?.current_stock ?? 0;
                  const reorderPoint = level?.reorder_point ?? null;
                  const isLow = reorderPoint !== null && currentStock <= reorderPoint;

                  return (
                    <div key={loc.id} className="rounded-md border p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-medium">{loc.name}</div>
                          {loc.location_type && (
                            <div className="text-xs text-muted-foreground capitalize">
                              {loc.location_type.replace('_', ' ')}
                            </div>
                          )}
                        </div>
                        <div className="text-xs font-mono text-muted-foreground">
                          Stock: {currentStock}
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium mb-1">Reorder Point</label>
                          <input
                            type="number"
                            min="0"
                            value={reorderPoint ?? ''}
                            onChange={(e) => handleLevelChange(loc.id, 'reorder_point', e.target.value)}
                            className="w-full px-2 py-1.5 border rounded-md text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium mb-1">Target Stock</label>
                          <input
                            type="number"
                            min="0"
                            value={level?.target_stock ?? ''}
                            onChange={(e) => handleLevelChange(loc.id, 'target_stock', e.target.value)}
                            className="w-full px-2 py-1.5 border rounded-md text-sm"
                          />
                        </div>
                      </div>

                      {isLow && (
                        <div className="mt-2 text-xs font-medium text-amber-600">
                          Warning: below reorder point
                        </div>
                      )}
                    </div>
                  );
                })}

                {locations.length === 0 && (
                  <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                    No locations found. Add a location to manage per-site stock.
                  </div>
                )}
              </div>
            </div>
          )}

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
              {saving ? (isEditing ? 'Updating...' : 'Creating...') : (isEditing ? 'Update Item' : 'Create Item')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
