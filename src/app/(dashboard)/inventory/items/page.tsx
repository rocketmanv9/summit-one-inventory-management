'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/FilterBar';
import { StatusChip } from '@/components/ui/StatusChip';
import { InventoryRPC } from '@/lib/rpc/inventory';

interface CatalogItem {
  id: string;
  name: string;
  sku: string;
  description?: string;
  category_id?: string;
  unit_of_measure: string;
  tracking_mode: 'stock' | 'serialized' | 'both';
  reorder_point?: number;
  min_stock_level?: number;
  max_stock_level?: number;
  active: boolean;
  item_categories?: { name: string };
  vendors?: { name: string };
}

interface Category {
  id: string;
  name: string;
}

type TrackingMode = CatalogItem['tracking_mode'];

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

  const handleDelete = async (itemId: string, itemName: string) => {
    if (!confirm(`Are you sure you want to delete "${itemName}"?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/inventory/items/${itemId}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete item');
      }

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
            onClick={() => handleDelete(row.id, row.name)}
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
    description: string;
    category_id: string;
    unit_of_measure: string;
    tracking_mode: TrackingMode;
    reorder_point: string;
  }>({
    name: item?.name || '',
    sku: item?.sku || '',
    description: item?.description || '',
    category_id: item?.category_id || '',
    unit_of_measure: item?.unit_of_measure || 'EA',
    tracking_mode: item?.tracking_mode || 'stock',
    reorder_point: item?.reorder_point?.toString() || '',
  });
  const [categories, setCategories] = useState<Category[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      const res = await fetch('/api/inventory/categories');
      if (res.ok) {
        const data = await res.json();
        setCategories(data.data || []);
      }
    } catch (err) {
      console.error('Error fetching categories:', err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      const url = isEditing ? `/api/inventory/items/${item.id}` : '/api/inventory/items';
      const method = isEditing ? 'PUT' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          category_id: form.category_id || null,
          reorder_point: form.reorder_point ? parseInt(form.reorder_point) : null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Failed to ${isEditing ? 'update' : 'create'} item`);
      }

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
            />
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
            <label className="block text-sm font-medium mb-1">Category</label>
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
