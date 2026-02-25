'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { InventoryRPC } from '@/lib/rpc/inventory';

interface NegativeInvConfig {
  id: string;
  scope: string;
  category_id: string | null;
  catalog_item_id: string | null;
  allow_negative: boolean;
  last_event_id: string;
  created_at: string;
  updated_at: string;
}

interface CategoryOption {
  id: string;
  name: string;
}

interface ItemOption {
  id: string;
  name: string;
  sku: string;
}

export default function NegativeInventoryPage() {
  const [configs, setConfigs] = useState<NegativeInvConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [items, setItems] = useState<ItemOption[]>([]);

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [configData, catData, itemData] = await Promise.all([
        InventoryRPC.getNegativeInventoryConfig(),
        InventoryRPC.getItemCategories(),
        InventoryRPC.getCatalogItems({ active: true }),
      ]);
      setConfigs(configData);
      setCategories((catData || []).map(c => ({ id: c.id, name: c.name })));
      setItems((itemData || []).map(i => ({ id: i.id, name: i.name, sku: i.sku })));
    } catch (error) {
      console.error('Error fetching negative inventory config:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (config: NegativeInvConfig) => {
    if (!confirm('Delete this negative inventory rule?')) return;
    try {
      await InventoryRPC.deleteNegativeInventoryConfig(config.id, config.last_event_id);
      await fetchAll();
    } catch (error: any) {
      alert(error?.message || 'Failed to delete config');
    }
  };

  const getCategoryName = (id: string | null) => {
    if (!id) return '-';
    return categories.find(c => c.id === id)?.name || id.slice(0, 8);
  };

  const getItemName = (id: string | null) => {
    if (!id) return '-';
    const item = items.find(i => i.id === id);
    return item ? `${item.name} (${item.sku})` : id.slice(0, 8);
  };

  const columns = [
    {
      key: 'scope',
      header: 'Scope',
      sortable: true,
      render: (row: NegativeInvConfig) => (
        <span className={`inline-flex px-2 py-1 text-xs font-medium rounded capitalize ${
          row.scope === 'global' ? 'bg-blue-100 text-blue-800' :
          row.scope === 'category' ? 'bg-purple-100 text-purple-800' :
          'bg-gray-100 text-gray-800'
        }`}>
          {row.scope}
        </span>
      ),
    },
    {
      key: 'target',
      header: 'Target',
      render: (row: NegativeInvConfig) => {
        if (row.scope === 'global') return <span className="text-muted-foreground">All items</span>;
        if (row.scope === 'category') return <span>{getCategoryName(row.category_id)}</span>;
        return <span>{getItemName(row.catalog_item_id)}</span>;
      },
    },
    {
      key: 'allow_negative',
      header: 'Allow Negative',
      render: (row: NegativeInvConfig) => (
        <span className={`inline-flex px-2 py-1 text-xs font-medium rounded ${
          row.allow_negative ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
        }`}>
          {row.allow_negative ? 'Allowed' : 'Blocked'}
        </span>
      ),
    },
    {
      key: 'updated_at',
      header: 'Updated',
      render: (row: NegativeInvConfig) => new Date(row.updated_at).toLocaleDateString(),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (row: NegativeInvConfig) => (
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
          title="Negative Inventory Rules"
          description="Control whether items can go below zero stock. Rules are evaluated item-level first, then category, then global. Default: negative inventory is blocked."
          actions={
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              + Add Rule
            </button>
          }
        />

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex gap-2">
            <span className="text-blue-600">i</span>
            <div className="flex-1">
              <h3 className="font-medium text-blue-900">How Rules Work</h3>
              <p className="text-sm text-blue-700 mt-1">
                When a stock movement would make an item go negative, the system checks rules in order:
                Item-level &rarr; Category-level &rarr; Global. If no rule is found, negative inventory
                is blocked by default. Use &quot;Allow&quot; rules for items where negative is acceptable
                (e.g., pre-sold orders).
              </p>
            </div>
          </div>
        </div>

        <DataTable
          data={configs}
          columns={columns}
          loading={loading}
          emptyMessage="No negative inventory rules configured. Default behavior: negative inventory is blocked for all items."
          rowKey={(row) => row.id}
        />

        {showCreateModal && (
          <CreateNegativeInvModal
            categories={categories}
            items={items}
            onClose={() => setShowCreateModal(false)}
            onCreated={() => {
              setShowCreateModal(false);
              fetchAll();
            }}
          />
        )}
      </div>
    </AppShell>
  );
}

function CreateNegativeInvModal({
  categories,
  items,
  onClose,
  onCreated,
}: {
  categories: CategoryOption[];
  items: ItemOption[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    scope: 'global' as 'global' | 'category' | 'item',
    category_id: '',
    catalog_item_id: '',
    allow_negative: true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      if (form.scope === 'category' && !form.category_id) {
        throw new Error('Please select a category');
      }
      if (form.scope === 'item' && !form.catalog_item_id) {
        throw new Error('Please select an item');
      }

      await InventoryRPC.upsertNegativeInventoryConfig({
        scope: form.scope,
        category_id: form.scope === 'category' ? form.category_id : null,
        catalog_item_id: form.scope === 'item' ? form.catalog_item_id : null,
        allow_negative: form.allow_negative,
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
          <h3 className="text-lg font-semibold">Add Negative Inventory Rule</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">x</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">Scope *</label>
            <select
              value={form.scope}
              onChange={(e) => setForm({ ...form, scope: e.target.value as any, category_id: '', catalog_item_id: '' })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="global">Global (all items)</option>
              <option value="category">Category</option>
              <option value="item">Specific Item</option>
            </select>
          </div>

          {form.scope === 'category' && (
            <div>
              <label className="block text-sm font-medium mb-1">Category *</label>
              <select
                value={form.category_id}
                onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                required
              >
                <option value="">Select category...</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </div>
          )}

          {form.scope === 'item' && (
            <div>
              <label className="block text-sm font-medium mb-1">Item *</label>
              <select
                value={form.catalog_item_id}
                onChange={(e) => setForm({ ...form, catalog_item_id: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                required
              >
                <option value="">Select item...</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>{item.name} ({item.sku})</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">Negative Inventory *</label>
            <select
              value={form.allow_negative ? 'allow' : 'block'}
              onChange={(e) => setForm({ ...form, allow_negative: e.target.value === 'allow' })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="allow">Allow negative inventory</option>
              <option value="block">Block negative inventory</option>
            </select>
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
              {saving ? 'Saving...' : 'Save Rule'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
