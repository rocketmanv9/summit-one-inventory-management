'use client';

import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Package, Search, Check, Layers } from 'lucide-react';

export interface PickerItem {
  id: string;
  name: string;
  sku: string;
  description?: string | null;
  uom_term_id: string | null;
  is_parent?: boolean;
}

interface ItemPickerModalProps {
  open: boolean;
  onClose: () => void;
  items: PickerItem[];
  imageMap: Record<string, string>;
  uomLabels: Record<string, string>;
  /** IDs already on the order — shown with an "Added" marker. */
  selectedIds?: string[];
  onSelect: (item: PickerItem) => void;
}

// Visual, searchable card grid for choosing a catalog item to add to a PO line.
// Each card shows the item's photo, name, SKU, description and unit so you can
// see exactly what you're picking instead of scanning a text dropdown.
export function ItemPickerModal({
  open,
  onClose,
  items,
  imageMap,
  uomLabels,
  selectedIds = [],
  onSelect,
}: ItemPickerModalProps) {
  const [query, setQuery] = useState('');
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        i.sku.toLowerCase().includes(q) ||
        (i.description || '').toLowerCase().includes(q)
    );
  }, [items, query]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Choose an item</DialogTitle>
        </DialogHeader>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, SKU or description..."
            className="w-full rounded-md border border-input bg-background py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        {/* Card grid */}
        <div className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto p-1 sm:grid-cols-3">
          {filtered.map((item) => {
            const url = imageMap[item.id];
            const isAdded = selected.has(item.id);
            const uom = uomLabels[item.uom_term_id || ''] || item.uom_term_id || '';

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item)}
                className="group relative flex flex-col overflow-hidden rounded-lg border border-border bg-card text-left transition-colors hover:border-primary hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {/* Photo — object-contain so nothing gets cropped */}
                <div className="flex h-32 w-full items-center justify-center border-b border-border bg-muted/30 p-2">
                  {url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={url}
                      alt={item.name}
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <Package className="h-10 w-10 text-muted-foreground/40" />
                  )}
                </div>

                {/* Added badge */}
                {isAdded && (
                  <span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground shadow">
                    <Check className="h-3 w-3" /> Added
                  </span>
                )}

                {/* Meta */}
                <div className="flex flex-1 flex-col gap-1 p-2.5">
                  <span className="line-clamp-2 text-sm font-semibold leading-snug">
                    {item.name}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">{item.sku}</span>
                  {item.description && (
                    <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">
                      {item.description}
                    </span>
                  )}
                  <div className="mt-auto flex flex-wrap items-center gap-1 pt-1">
                    {uom && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {uom}
                      </span>
                    )}
                    {item.is_parent && (
                      <span className="flex items-center gap-0.5 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
                        <Layers className="h-2.5 w-2.5" /> Variants
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}

          {filtered.length === 0 && (
            <div className="col-span-full py-12 text-center text-sm text-muted-foreground">
              No items match &quot;{query}&quot;.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
