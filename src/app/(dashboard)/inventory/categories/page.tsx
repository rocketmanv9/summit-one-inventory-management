'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { InventoryRPC } from '@/lib/rpc/inventory';
import type { Database } from 'types/supabase';

type Category = Database['inventory']['Tables']['item_categories']['Row'];

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | undefined>();
  const [showReassignModal, setShowReassignModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Category | undefined>();
  const [reassignCount, setReassignCount] = useState(0);
  const [reassignError, setReassignError] = useState('');

  const formatDate = (value?: string | null) => {
    if (!value) return '-';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '-';
    return parsed.toLocaleDateString();
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    setLoading(true);
    try {
      const data = await InventoryRPC.getItemCategories();
      setCategories(data || []);
    } catch (err) {
      console.error('Error fetching categories:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (category: Category) => {
    try {
      const itemCount = await InventoryRPC.countCatalogItemsByCategory(category.id);
      if (itemCount > 0) {
        setDeleteTarget(category);
        setReassignCount(itemCount);
        setReassignError('');
        setShowReassignModal(true);
        return;
      }

      if (!confirm('Are you sure you want to delete this category?')) {
        return;
      }

      if (!category.last_event_id) {
        throw new Error('Missing last_event_id for this category. Please refresh and try again.');
      }

      await InventoryRPC.deleteItemCategory(category.id, category.last_event_id);
      fetchCategories();
    } catch (err) {
      console.error('Error deleting category:', err);
      alert(err instanceof Error ? err.message : 'Failed to delete category');
    }
  };

  return (
    <AppShell>
      <PageHeader
        title="Item Categories"
        description="Manage item categories for inventory organization"
        actions={
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Create Category
          </button>
        }
      />

      <div className="p-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
          {loading ? (
            <div className="p-8 text-center text-gray-500">Loading categories...</div>
          ) : categories.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              No categories found. Create your first category to get started.
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Category Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Created
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Updated
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {categories.map((cat) => (
                  <tr key={cat.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">
                      {cat.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {formatDate(cat.created_at)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {formatDate(cat.updated_at)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => {
                          setEditingCategory(cat);
                          setShowCreateModal(true);
                        }}
                        className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300 mr-4"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(cat)}
                        className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {showCreateModal && (
          <CreateCategoryModal
            category={editingCategory}
            onClose={() => {
              setShowCreateModal(false);
              setEditingCategory(undefined);
            }}
            onCreated={() => {
              setShowCreateModal(false);
              setEditingCategory(undefined);
              fetchCategories();
            }}
          />
        )}
        {showReassignModal && deleteTarget && (
          <ReassignCategoryModal
            categories={categories}
            deleteCategory={deleteTarget}
            itemCount={reassignCount}
            error={reassignError}
            onClose={() => {
              setShowReassignModal(false);
              setDeleteTarget(undefined);
              setReassignCount(0);
              setReassignError('');
            }}
            onComplete={() => {
              setShowReassignModal(false);
              setDeleteTarget(undefined);
              setReassignCount(0);
              setReassignError('');
              fetchCategories();
            }}
            onError={(message) => setReassignError(message)}
          />
        )}
      </div>
    </AppShell>
  );
}

function ReassignCategoryModal({
  categories,
  deleteCategory,
  itemCount,
  error,
  onClose,
  onComplete,
  onError,
}: {
  categories: Category[];
  deleteCategory: Category;
  itemCount: number;
  error: string;
  onClose: () => void;
  onComplete: () => void;
  onError: (message: string) => void;
}) {
  const [targetCategoryId, setTargetCategoryId] = useState('');
  const [saving, setSaving] = useState(false);

  const eligibleCategories = categories.filter((cat) => cat.id !== deleteCategory.id);

  const handleConfirm = async () => {
    if (!targetCategoryId) {
      onError('Choose a new category to move items into before deleting.');
      return;
    }

    if (!deleteCategory.last_event_id) {
      onError('Missing last_event_id for this category. Please refresh and try again.');
      return;
    }

    setSaving(true);
    onError('');

    try {
      await InventoryRPC.reassignCatalogItemsCategory(deleteCategory.id, targetCategoryId);
      await InventoryRPC.deleteItemCategory(deleteCategory.id, deleteCategory.last_event_id);
      onComplete();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reassign items and delete category.';
      onError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md">
        <h3 className="text-lg font-semibold mb-2">Reassign items before deleting</h3>
        <p className="text-sm text-muted-foreground mb-4">
          This category has {itemCount.toLocaleString()} item{itemCount === 1 ? '' : 's'}. Choose a new category to move them into before deleting.
        </p>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">New Category</label>
          <select
            value={targetCategoryId}
            onChange={(e) => setTargetCategoryId(e.target.value)}
            className="w-full px-3 py-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
          >
            <option value="">-- Select Category --</option>
            {eligibleCategories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-md text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
            disabled={saving || eligibleCategories.length === 0}
          >
            {saving ? 'Reassigning...' : 'Reassign & Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateCategoryModal({ 
  onClose, 
  onCreated,
  category 
}: { 
  onClose: () => void; 
  onCreated: () => void;
  category?: Category;
}) {
  const [name, setName] = useState(category?.name || '');
  const [skuPrefix, setSkuPrefix] = useState(category?.sku_prefix || '');
  const [skuMode, setSkuMode] = useState<Category['sku_mode']>(category?.sku_mode || 'sequential');
  const [parentCategoryId, setParentCategoryId] = useState(category?.parent_category_id || '');
  const [separator, setSeparator] = useState('-');
  const [nextSequence, setNextSequence] = useState('1');
  const [categories, setCategories] = useState<Category[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const isEditing = !!category;

  const buildSkuPreview = () => {
    const prefix = skuPrefix ? skuPrefix.toUpperCase() : '';
    const parent = categories.find((cat) => cat.id === parentCategoryId);
    const parentPrefix = parent?.sku_prefix ? parent.sku_prefix.toUpperCase() : '';
    const sep = separator || '-';
    const seq = String(Math.max(1, Number(nextSequence) || 1)).padStart(3, '0');

    if (skuMode === 'manual') {
      return 'MANUAL-SKU-001';
    }

    if (skuMode === 'attribute_based') {
      const parts = [parentPrefix, prefix, seq].filter(Boolean);
      return parts.join(sep) || `SKU${sep}${seq}`;
    }

    return prefix ? `${prefix}${sep}${seq}` : `SKU${sep}${seq}`;
  };

  useEffect(() => {
    async function loadCategories() {
      try {
        const data = await InventoryRPC.getItemCategories();
        setCategories(data || []);
      } catch (err) {
        console.error('Error loading categories:', err);
      }
    }

    async function loadSkuSettings() {
      if (!category?.id) return;
      try {
        const data = await InventoryRPC.getSkuSettings(category.id);
        if (data) {
          setSeparator(data.separator || '-');
          setNextSequence(String(data.next_sequence ?? 1));
        }
      } catch (err) {
        console.error('Error loading SKU settings:', err);
      }
    }

    loadCategories();
    loadSkuSettings();
  }, [category?.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      const payload = {
        name,
        sku_prefix: skuPrefix || null,
        sku_mode: skuMode || null,
        parent_category_id: parentCategoryId || null,
      };

      let categoryId = category?.id;

      if (isEditing && category) {
        if (!category.last_event_id) {
          throw new Error('Missing last_event_id for this category. Please refresh and try again.');
        }

        await InventoryRPC.updateItemCategory(category.id, payload, category.last_event_id);
      } else {
        const created = await InventoryRPC.createItemCategory({
          ...payload,
          last_event_id: crypto.randomUUID(),
        });
        categoryId = created.id;
      }

      if (categoryId) {
        await InventoryRPC.upsertSkuSettings({
          category_id: categoryId,
          separator: separator || '-',
          next_sequence: Math.max(1, Number(nextSequence) || 1),
        });
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
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md">
        <h3 className="text-lg font-semibold mb-4">
          {isEditing ? 'Edit Category' : 'Create Category'}
        </h3>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">
              Category Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
              placeholder="e.g., Raw Materials, Finished Goods, Tools"
              required
              autoFocus
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">Parent Category (Optional)</label>
            <select
              value={parentCategoryId}
              onChange={(e) => setParentCategoryId(e.target.value)}
              className="w-full px-3 py-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
            >
              <option value="">-- None --</option>
              {categories
                .filter((cat) => cat.id !== category?.id)
                .map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-1">SKU Prefix</label>
              <input
                type="text"
                value={skuPrefix}
                onChange={(e) => setSkuPrefix(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                placeholder="e.g., FUR"
                maxLength={5}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">SKU Mode</label>
              <select
                value={skuMode || 'sequential'}
                onChange={(e) => setSkuMode(e.target.value as Category['sku_mode'])}
                className="w-full px-3 py-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
              >
                <option value="sequential">Sequential</option>
                <option value="attribute_based">Attribute Based</option>
                <option value="manual">Manual</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-1">SKU Separator</label>
              <input
                type="text"
                value={separator}
                onChange={(e) => setSeparator(e.target.value || '-')}
                className="w-full px-3 py-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
                placeholder="-"
                maxLength={2}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Next Sequence</label>
              <input
                type="number"
                min="1"
                value={nextSequence}
                onChange={(e) => setNextSequence(e.target.value)}
                className="w-full px-3 py-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
              />
            </div>
          </div>

          <div className="mb-4 rounded-md border border-dashed border-blue-200 bg-blue-50/60 p-3 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-blue-600">SKU Preview</div>
            <div className="mt-1 font-mono text-base text-blue-900">
              {buildSkuPreview()}
            </div>
            <p className="mt-1 text-xs text-blue-700">
              Example of how new items will be labeled for this category.
            </p>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-md text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              disabled={saving}
            >
              {saving ? 'Saving...' : isEditing ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
