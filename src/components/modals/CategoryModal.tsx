'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Loader2 } from 'lucide-react';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { AppError } from '@rocketmanv9/chassis/errors';
import type { Database } from 'types/supabase';

type Category = Database['inventory']['Tables']['item_categories']['Row'];

interface CategoryModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (name: string) => void;
  item?: Category;
  defaultName?: string;
  defaultSkuPrefix?: string;
}

export function CategoryModal({ open, onClose, onSuccess, item, defaultName, defaultSkuPrefix }: CategoryModalProps) {
  const isEdit = !!item;
  const [name, setName] = useState('');
  const [skuPrefix, setSkuPrefix] = useState('');
  const [skuMode, setSkuMode] = useState<Category['sku_mode']>('sequential');
  const [parentCategoryId, setParentCategoryId] = useState('');
  const [separator, setSeparator] = useState('-');
  const [nextSequence, setNextSequence] = useState('1');
  const [categories, setCategories] = useState<Category[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    setError(null);
    setSubmitting(false);

    if (isEdit && item) {
      setName(item.name || '');
      setSkuPrefix(item.sku_prefix || '');
      setSkuMode(item.sku_mode || 'sequential');
      setParentCategoryId(item.parent_category_id || '');
    } else {
      setName(defaultName || '');
      setSkuPrefix(defaultSkuPrefix || '');
      setSkuMode('sequential');
      setParentCategoryId('');
      setSeparator('-');
      setNextSequence('1');
    }

    loadCategories();
    if (isEdit && item?.id) {
      loadSkuSettings(item.id);
    }
  }, [open, item, isEdit]);

  async function loadCategories() {
    try {
      const data = await InventoryRPC.getItemCategories();
      setCategories(data || []);
    } catch (err) {
      console.error('Error loading categories:', err);
    }
  }

  async function loadSkuSettings(categoryId: string) {
    try {
      const data = await InventoryRPC.getSkuSettings(categoryId);
      if (data) {
        setSeparator(data.separator || '-');
        setNextSequence(String(data.next_sequence ?? 1));
      }
    } catch (err) {
      console.error('Error loading SKU settings:', err);
    }
  }

  const buildSkuPreview = () => {
    const prefix = skuPrefix ? skuPrefix.toUpperCase() : '';
    const parent = categories.find((cat) => cat.id === parentCategoryId);
    const parentPrefix = parent?.sku_prefix ? parent.sku_prefix.toUpperCase() : '';
    const sep = separator || '-';
    const seq = String(Math.max(1, Number(nextSequence) || 1)).padStart(3, '0');

    if (skuMode === 'manual') return 'MANUAL-SKU-001';
    if (skuMode === 'attribute_based') {
      const parts = [parentPrefix, prefix, seq].filter(Boolean);
      return parts.join(sep) || `SKU${sep}${seq}`;
    }
    return prefix ? `${prefix}${sep}${seq}` : `SKU${sep}${seq}`;
  };

  async function handleSubmit() {
    if (!name.trim()) {
      setError('Category name is required.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const payload = {
        name: name.trim(),
        sku_prefix: skuPrefix || null,
        sku_mode: skuMode || null,
        parent_category_id: parentCategoryId || null,
      };

      let categoryId = item?.id;

      if (isEdit && item) {
        if (!item.last_event_id) {
          throw AppError.badRequest('Missing last_event_id for this category. Please refresh and try again.');
        }
        await InventoryRPC.updateItemCategory(item.id, payload, item.last_event_id);
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

      onSuccess(name.trim());
    } catch (err: any) {
      setError(err.message || 'Failed to save category.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Category' : 'Create Category'}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'Update category details below.' : 'Enter category details to organize your inventory items.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="cat-name">Category Name *</Label>
            <Input
              id="cat-name"
              value={name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setName(e.target.value); if (error) setError(null); }}
              placeholder="e.g., Raw Materials, Finished Goods, Tools"
              disabled={submitting}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cat-parent">Parent Category</Label>
            <select
              id="cat-parent"
              value={parentCategoryId}
              onChange={(e) => setParentCategoryId(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              disabled={submitting}
            >
              <option value="">-- None --</option>
              {categories
                .filter((cat) => cat.id !== item?.id)
                .map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="cat-sku-prefix">SKU Prefix</Label>
              <Input
                id="cat-sku-prefix"
                value={skuPrefix}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSkuPrefix(e.target.value.toUpperCase())}
                placeholder="e.g., FUR"
                maxLength={5}
                disabled={submitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cat-sku-mode">SKU Mode</Label>
              <select
                id="cat-sku-mode"
                value={skuMode || 'sequential'}
                onChange={(e) => setSkuMode(e.target.value as Category['sku_mode'])}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                disabled={submitting}
              >
                <option value="sequential">Sequential</option>
                <option value="attribute_based">Attribute Based</option>
                <option value="manual">Manual</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="cat-separator">SKU Separator</Label>
              <Input
                id="cat-separator"
                value={separator}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSeparator(e.target.value || '-')}
                placeholder="-"
                maxLength={2}
                disabled={submitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cat-next-seq">Next Sequence</Label>
              <Input
                id="cat-next-seq"
                type="number"
                min="1"
                value={nextSequence}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNextSequence(e.target.value)}
                disabled={submitting}
              />
            </div>
          </div>

          <div className="rounded-md border border-dashed border-blue-200 bg-blue-50/60 p-3 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-blue-600">SKU Preview</div>
            <div className="mt-1 font-mono text-base text-blue-900">{buildSkuPreview()}</div>
            <p className="mt-1 text-xs text-blue-700">
              Example of how new items will be labeled for this category.
            </p>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEdit ? 'Update Category' : 'Create Category'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
