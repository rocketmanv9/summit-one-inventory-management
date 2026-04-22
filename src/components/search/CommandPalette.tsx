'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search,
  Package,
  MapPin,
  Truck,
  Users,
  ShoppingCart,
  CalendarCheck,
  X,
  CornerDownLeft,
} from 'lucide-react';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { cn } from '@/lib/utils';

type SearchResults = Awaited<ReturnType<typeof InventoryRPC.globalSearch>>;

interface ResultItem {
  id: string;
  label: string;
  sublabel?: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface ResultGroup {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  items: ResultItem[];
}

function flattenResults(results: SearchResults): ResultGroup[] {
  const groups: ResultGroup[] = [];

  if (results.items.length > 0) {
    groups.push({
      key: 'items',
      label: 'Items',
      icon: Package,
      items: results.items.map((i) => ({
        id: i.id,
        label: i.name,
        sublabel: i.sku,
        url: i.url_hint,
        icon: Package,
      })),
    });
  }

  if (results.assets.length > 0) {
    groups.push({
      key: 'assets',
      label: 'Assets',
      icon: Truck,
      items: results.assets.map((a) => ({
        id: a.id,
        label: a.tag || a.serial_number || a.id.slice(0, 8),
        sublabel: a.status,
        url: a.url_hint,
        icon: Truck,
      })),
    });
  }

  if (results.locations.length > 0) {
    groups.push({
      key: 'locations',
      label: 'Locations',
      icon: MapPin,
      items: results.locations.map((l) => ({
        id: l.id,
        label: l.name,
        sublabel: l.address || undefined,
        url: l.url_hint,
        icon: MapPin,
      })),
    });
  }

  if (results.vendors.length > 0) {
    groups.push({
      key: 'vendors',
      label: 'Vendors',
      icon: Users,
      items: results.vendors.map((v) => ({
        id: v.id,
        label: v.name,
        sublabel: v.code || undefined,
        url: v.url_hint,
        icon: Users,
      })),
    });
  }

  if (results.purchase_orders.length > 0) {
    groups.push({
      key: 'purchase_orders',
      label: 'Purchase Orders',
      icon: ShoppingCart,
      items: results.purchase_orders.map((po) => ({
        id: po.id,
        label: po.po_number,
        sublabel: [po.vendor_name, po.status].filter(Boolean).join(' - '),
        url: po.url_hint,
        icon: ShoppingCart,
      })),
    });
  }

  if (results.reservations.length > 0) {
    groups.push({
      key: 'reservations',
      label: 'Reservations',
      icon: CalendarCheck,
      items: results.reservations.map((r) => ({
        id: r.id,
        label: r.ref || r.id.slice(0, 8),
        sublabel: r.status,
        url: r.url_hint,
        icon: CalendarCheck,
      })),
    });
  }

  return groups;
}

function getAllItems(groups: ResultGroup[]): ResultItem[] {
  return groups.flatMap((g) => g.items);
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Open/close with Cmd+K / Ctrl+K
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  // Focus input on open
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
      setResults(null);
      setSelectedIndex(0);
    }
  }, [open]);

  // Debounced search
  const doSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await InventoryRPC.globalSearch(q, 5);
      setResults(data);
      setSelectedIndex(0);
    } catch (err) {
      console.error('[CommandPalette] search error:', err);
      setResults(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(query), 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, doSearch]);

  const groups = results ? flattenResults(results) : [];
  const allItems = getAllItems(groups);
  const totalResults = allItems.length;

  // Keyboard navigation
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, totalResults - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && totalResults > 0) {
      e.preventDefault();
      const item = allItems[selectedIndex];
      if (item) {
        router.push(item.url);
        setOpen(false);
      }
    }
  }

  // Scroll selected into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!open) return null;

  let flatIndex = -1;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 transition-opacity"
        onClick={() => setOpen(false)}
      />

      {/* Palette */}
      <div className="fixed left-1/2 top-[20%] w-full max-w-xl -translate-x-1/2">
        <div className="mx-4 overflow-hidden rounded-xl border bg-background shadow-2xl">
          {/* Search input */}
          <div className="flex items-center border-b px-4">
            <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search items, locations, vendors, POs..."
              className="flex-1 border-0 bg-transparent px-3 py-4 text-sm outline-none placeholder:text-muted-foreground"
              autoComplete="off"
              spellCheck="false"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="rounded p-1 hover:bg-muted"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            )}
          </div>

          {/* Results */}
          <div ref={listRef} className="max-h-80 overflow-y-auto p-2">
            {loading && (
              <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                Searching...
              </div>
            )}

            {!loading && query.length >= 2 && totalResults === 0 && (
              <div className="flex flex-col items-center justify-center py-6 text-sm text-muted-foreground">
                <Search className="mb-2 h-8 w-8 opacity-40" />
                No results for &quot;{query}&quot;
              </div>
            )}

            {!loading && query.length > 0 && query.length < 2 && (
              <div className="py-4 text-center text-sm text-muted-foreground">
                Type at least 2 characters to search
              </div>
            )}

            {!loading && groups.map((group) => (
              <div key={group.key} className="mb-1">
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <group.icon className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {group.label}
                  </span>
                </div>
                {group.items.map((item) => {
                  flatIndex++;
                  const idx = flatIndex;
                  const isSelected = idx === selectedIndex;
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      data-index={idx}
                      onClick={() => {
                        router.push(item.url);
                        setOpen(false);
                      }}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
                        isSelected
                          ? 'bg-primary text-primary-foreground'
                          : 'hover:bg-muted'
                      )}
                    >
                      <Icon className={cn('h-4 w-4 shrink-0', isSelected ? 'text-primary-foreground' : 'text-muted-foreground')} />
                      <div className="flex-1 truncate">
                        <span className="font-medium">{item.label}</span>
                        {item.sublabel && (
                          <span className={cn('ml-2 text-xs', isSelected ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                            {item.sublabel}
                          </span>
                        )}
                      </div>
                      {isSelected && (
                        <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-primary-foreground/70" />
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
            <div className="flex gap-3">
              <span className="flex items-center gap-1">
                <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">&uarr;&darr;</kbd>
                navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">&crarr;</kbd>
                open
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">esc</kbd>
                close
              </span>
            </div>
            {totalResults > 0 && (
              <span>{totalResults} result{totalResults !== 1 ? 's' : ''}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
