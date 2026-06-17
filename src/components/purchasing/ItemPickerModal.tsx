'use client';

import { useMemo, useState, type ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Package, Search, Check, Layers, SearchX } from 'lucide-react';

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
  /** Shown when there are no items at all to pick from (e.g. no vendor chosen). */
  emptyMessage?: ReactNode;
  onSelect: (item: PickerItem) => void;
}

// Visual, searchable product gallery for choosing a catalog item to add to a
// PO line. Uniform square tiles (white bg, object-contain) keep the grid tidy
// without cropping photos; each card shows name, SKU, description and unit.
export function ItemPickerModal({
  open,
  onClose,
  items,
  imageMap,
  uomLabels,
  selectedIds = [],
  emptyMessage,
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
      <DialogContent className="max-w-4xl gap-0 overflow-hidden p-0">
        {/* Header + search (stays put while the grid scrolls) */}
        <div className="border-b bg-background px-6 pb-4 pt-6">
          <DialogHeader>
            <DialogTitle>Choose an item</DialogTitle>
            <DialogDescription>
              {filtered.length} item{filtered.length === 1 ? '' : 's'} · tap a card to add it to this line
            </DialogDescription>
          </DialogHeader>

          <div className="relative mt-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, SKU or description..."
              className="h-10 w-full rounded-lg border border-input bg-muted/30 pl-9 pr-3 text-sm transition-colors focus:border-primary focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        </div>

        {/* Card grid */}
        <div className="max-h-[62vh] overflow-y-auto bg-muted/20 px-6 py-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {filtered.map((item) => {
              const url = imageMap[item.id];
              const isAdded = selected.has(item.id);
              const uom = uomLabels[item.uom_term_id || ''] || item.uom_term_id || '';

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(item)}
                  className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card text-left shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-primary hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {/* Photo — 4:3 tile the image fills, so cards read full, not empty */}
                  <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
                    {url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={url}
                        alt={item.name}
                        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <Package className="h-9 w-9 text-muted-foreground/40" />
                      </div>
                    )}
                    {isAdded && (
                      <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground shadow">
                        <Check className="h-3 w-3" /> Added
                      </span>
                    )}
                  </div>

                  {/* Meta */}
                  <div className="flex flex-1 flex-col gap-1 p-2.5">
                    <span className="line-clamp-2 text-[13px] font-semibold leading-snug text-foreground">
                      {item.name}
                    </span>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="font-mono">{item.sku}</span>
                      {uom && (
                        <>
                          <span className="text-muted-foreground/40">·</span>
                          <span>{uom}</span>
                        </>
                      )}
                    </div>
                    {item.description && (
                      <span className="line-clamp-1 text-xs leading-snug text-muted-foreground/80">
                        {item.description}
                      </span>
                    )}
                    {item.is_parent && (
                      <span className="mt-auto inline-flex w-fit items-center gap-0.5 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
                        <Layers className="h-2.5 w-2.5" /> Variants
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {filtered.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
              {items.length === 0 ? (
                <>
                  <Package className="h-8 w-8 text-muted-foreground/40" />
                  <p className="max-w-xs text-sm">
                    {emptyMessage ?? 'No items available.'}
                  </p>
                </>
              ) : (
                <>
                  <SearchX className="h-8 w-8 text-muted-foreground/40" />
                  <p className="text-sm">
                    No items match <span className="font-medium">&quot;{query}&quot;</span>.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
