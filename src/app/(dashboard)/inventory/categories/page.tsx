'use client';

import { AppError } from '@rocketmanv9/chassis/errors';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/FilterBar';
import { CategoryModal } from '@/components/modals/CategoryModal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { InventoryRPC } from '@/lib/rpc/inventory';
import type { Database } from 'types/supabase';

type Category = Database['inventory']['Tables']['item_categories']['Row'];

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [showReassignModal, setShowReassignModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Category | undefined>();
  const [reassignCount, setReassignCount] = useState(0);
  const [reassignError, setReassignError] = useState('');
  const [confirmDeleteTarget, setConfirmDeleteTarget] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

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

      setDeleteError('');
      setConfirmDeleteTarget(category);
    } catch (err) {
      console.error('Error deleting category:', err);
      alert(err instanceof Error ? err.message : 'Failed to delete category');
    }
  };

  const confirmDelete = async () => {
    if (!confirmDeleteTarget) return;
    setDeleting(true);
    setDeleteError('');

    try {
      if (!confirmDeleteTarget.last_event_id) {
        throw AppError.badRequest('Missing last_event_id for this category. Please refresh and try again.');
      }

      await InventoryRPC.deleteItemCategory(confirmDeleteTarget.id, confirmDeleteTarget.last_event_id);
      setConfirmDeleteTarget(null);
      fetchCategories();
    } catch (err) {
      console.error('Error deleting category:', err);
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete category');
    } finally {
      setDeleting(false);
    }
  };

  const columns = [
    {
      key: 'name',
      header: 'Category Name',
      sortable: true,
      render: (row: Category) => (
        <span className="font-medium">{row.name}</span>
      ),
    },
    {
      key: 'created_at',
      header: 'Created',
      sortable: true,
      render: (row: Category) => formatDate(row.created_at),
    },
    {
      key: 'updated_at',
      header: 'Updated',
      sortable: true,
      render: (row: Category) => formatDate(row.updated_at),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (row: Category) => (
        <div className="flex gap-3">
          <button
            onClick={() => setEditingCategory(row)}
            className="text-slate-600 hover:text-slate-900 text-sm font-medium"
          >
            Edit
          </button>
          <button
            onClick={() => handleDelete(row)}
            className="text-red-600 hover:text-red-800 text-sm font-medium"
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
      placeholder: 'Category name...',
    },
  ];

  const filteredCategories = categories.filter((cat) => {
    if (filters.search) {
      return cat.name.toLowerCase().includes(filters.search.toLowerCase());
    }
    return true;
  });

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Item Categories"
          description="Manage item categories for inventory organization"
          actions={
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              + Add Category
            </button>
          }
        />

        <FilterBar
          filters={filterConfig}
          values={filters}
          onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
          onClear={() => setFilters({})}
        />

        <DataTable
          data={filteredCategories}
          columns={columns}
          loading={loading}
          emptyMessage="No categories found. Create your first category to get started."
          rowKey={(row) => row.id}
        />

        <CategoryModal
          open={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            fetchCategories();
          }}
        />

        <CategoryModal
          open={!!editingCategory}
          onClose={() => setEditingCategory(null)}
          onSuccess={() => {
            setEditingCategory(null);
            fetchCategories();
          }}
          item={editingCategory ?? undefined}
        />

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

        {/* Delete category confirmation (no items attached) */}
        <ConfirmDialog
          open={!!confirmDeleteTarget}
          title="Delete category"
          message="Are you sure you want to delete this category?"
          confirmLabel="Delete"
          loadingLabel="Deleting..."
          destructive
          loading={deleting}
          error={deleteError}
          onConfirm={confirmDelete}
          onCancel={() => { setConfirmDeleteTarget(null); setDeleteError(''); }}
        />
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
