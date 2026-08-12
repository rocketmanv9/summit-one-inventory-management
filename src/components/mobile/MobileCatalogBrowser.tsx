'use client';

import { useState, useEffect, useCallback, type CSSProperties } from 'react';
import { apiErrorMessage } from '@/lib/api-error';

interface CatalogItem {
  id: string;
  name: string;
  sku?: string;
  barcode?: string;
  tracking_mode?: string;
  category_id?: string;
  in_count: boolean;
}

interface Category {
  id: string;
  name: string;
  sku_prefix?: string;
}

interface MobileCatalogBrowserProps {
  isOpen: boolean;
  onClose: () => void;
  onItemAdded: (line: any) => void;
  jwt: string;
  bypassSecret: string;
  existingItemIds: Set<string>;
  categories: Category[];
}

function bypassHeaders(secret: string): Record<string, string> {
  return secret ? { 'x-vercel-protection-bypass': secret } : {};
}

function withBypass(url: string, secret: string): string {
  if (!secret) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}x-vercel-protection-bypass=${encodeURIComponent(secret)}`;
}

export function MobileCatalogBrowser({
  isOpen,
  onClose,
  onItemAdded,
  jwt,
  bypassSecret,
  existingItemIds,
  categories,
}: MobileCatalogBrowserProps) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [localAddedIds, setLocalAddedIds] = useState<Set<string>>(new Set());

  const fetchItems = useCallback(async (catId: string | null, reset: boolean) => {
    setLoading(true);
    const newOffset = reset ? 0 : offset;

    try {
      let url = `/api/m/count/catalog?offset=${newOffset}&limit=50`;
      if (catId) url += `&category_id=${catId}`;

      const res = await fetch(withBypass(url, bypassSecret), {
        headers: {
          Authorization: `Bearer ${jwt}`,
          ...bypassHeaders(bypassSecret),
        },
      });

      if (!res.ok) return;

      const { data, has_more } = await res.json();
      if (reset) {
        setItems(data || []);
        setOffset(data?.length || 0);
      } else {
        setItems((prev) => [...prev, ...(data || [])]);
        setOffset((prev) => prev + (data?.length || 0));
      }
      setHasMore(!!has_more);
    } catch {
      // Silent fail
    } finally {
      setLoading(false);
    }
  }, [jwt, bypassSecret, offset]);

  useEffect(() => {
    if (isOpen) {
      setLocalAddedIds(new Set());
      fetchItems(selectedCategory, true);
    }
  }, [isOpen]);

  const handleCategoryChange = (catId: string | null) => {
    setSelectedCategory(catId);
    setOffset(0);
    fetchItems(catId, true);
  };

  const handleLoadMore = () => {
    fetchItems(selectedCategory, false);
  };

  const handleAddItem = async (itemId: string) => {
    if (addingId) return;
    setAddingId(itemId);

    try {
      const res = await fetch(withBypass('/api/m/count/add-item', bypassSecret), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`,
          'X-Idempotency-Key': crypto.randomUUID(),
          ...bypassHeaders(bypassSecret),
        },
        body: JSON.stringify({ catalog_item_id: itemId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(apiErrorMessage(data, 'Failed to add item'));
      }

      const { data } = await res.json();
      const catalogItem = items.find((i) => i.id === itemId);

      const newLine = {
        id: data.id,
        catalog_item_id: itemId,
        catalog_item: catalogItem ? {
          name: catalogItem.name,
          sku: catalogItem.sku,
          barcode: catalogItem.barcode,
          tracking_mode: catalogItem.tracking_mode,
        } : data.catalog_item,
        qty_expected: data.qty_expected ?? 0,
        qty_counted: null,
      };

      onItemAdded(newLine);
      setLocalAddedIds((prev) => new Set(prev).add(itemId));
    } catch (err: any) {
      alert(err.message || 'Failed to add item');
    } finally {
      setAddingId(null);
    }
  };

  if (!isOpen) return null;

  const isInCount = (id: string) => existingItemIds.has(id) || localAddedIds.has(id);

  const s: Record<string, CSSProperties> = {
    overlay: {
      position: 'fixed',
      inset: 0,
      background: '#f3f4f6',
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      paddingTop: 'env(safe-area-inset-top, 0px)',
    },
    header: {
      background: '#fff',
      padding: '16px 20px',
      borderBottom: '1px solid #e5e7eb',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    title: {
      fontSize: '18px',
      fontWeight: 700,
      color: '#111827',
      margin: 0,
    },
    closeBtn: {
      padding: '8px',
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      color: '#6b7280',
    },
    chips: {
      padding: '12px 16px',
      background: '#fff',
      borderBottom: '1px solid #e5e7eb',
      display: 'flex',
      gap: '8px',
      overflowX: 'auto' as const,
      WebkitOverflowScrolling: 'touch' as any,
    },
    chip: {
      padding: '6px 14px',
      borderRadius: '9999px',
      fontSize: '13px',
      fontWeight: 500,
      border: 'none',
      cursor: 'pointer',
      whiteSpace: 'nowrap' as const,
      flexShrink: 0,
    },
    list: {
      flex: 1,
      overflowY: 'auto' as const,
      padding: '12px 16px',
    },
    itemRow: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '12px 14px',
      background: '#fff',
      borderRadius: '10px',
      marginBottom: '6px',
      boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
    },
    itemName: {
      fontSize: '14px',
      fontWeight: 500,
      color: '#111827',
    },
    itemSku: {
      fontSize: '11px',
      color: '#6b7280',
      fontFamily: 'ui-monospace, monospace',
    },
    addBtn: {
      marginLeft: '8px',
      padding: '6px 14px',
      borderRadius: '8px',
      fontWeight: 600,
      fontSize: '13px',
      border: 'none',
      cursor: 'pointer',
      whiteSpace: 'nowrap' as const,
    },
    loadMore: {
      padding: '12px',
      background: '#fff',
      borderRadius: '10px',
      fontSize: '14px',
      fontWeight: 500,
      color: '#2563eb',
      border: 'none',
      cursor: 'pointer',
      width: '100%',
      textAlign: 'center' as const,
      marginTop: '8px',
    },
    empty: {
      textAlign: 'center' as const,
      padding: '40px 20px',
      color: '#9ca3af',
      fontSize: '14px',
    },
  };

  return (
    <div style={s.overlay}>
      {/* Header */}
      <div style={s.header}>
        <h2 style={s.title}>Browse Catalog</h2>
        <button style={s.closeBtn} onClick={onClose}>
          <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Category chips */}
      <div style={s.chips}>
        <button
          style={{
            ...s.chip,
            background: selectedCategory === null ? '#2563eb' : '#f3f4f6',
            color: selectedCategory === null ? '#fff' : '#374151',
          }}
          onClick={() => handleCategoryChange(null)}
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat.id}
            style={{
              ...s.chip,
              background: selectedCategory === cat.id ? '#2563eb' : '#f3f4f6',
              color: selectedCategory === cat.id ? '#fff' : '#374151',
            }}
            onClick={() => handleCategoryChange(cat.id)}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Items list */}
      <div style={s.list}>
        {loading && items.length === 0 && (
          <div style={s.empty}>Loading...</div>
        )}

        {!loading && items.length === 0 && (
          <div style={s.empty}>No catalog items found</div>
        )}

        {items.map((item) => {
          const alreadyAdded = isInCount(item.id) || item.in_count;
          return (
            <div key={item.id} style={s.itemRow}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={s.itemName}>{item.name}</div>
                {item.sku && <div style={s.itemSku}>{item.sku}</div>}
              </div>
              <button
                style={{
                  ...s.addBtn,
                  background: alreadyAdded ? '#e5e7eb' : addingId === item.id ? '#9ca3af' : '#2563eb',
                  color: alreadyAdded ? '#9ca3af' : '#fff',
                  cursor: alreadyAdded || addingId === item.id ? 'default' : 'pointer',
                }}
                onClick={() => !alreadyAdded && handleAddItem(item.id)}
                disabled={alreadyAdded || addingId === item.id}
              >
                {alreadyAdded ? 'In Count' : addingId === item.id ? 'Adding...' : '+ Add'}
              </button>
            </div>
          );
        })}

        {hasMore && !loading && (
          <button style={s.loadMore} onClick={handleLoadMore}>
            Load More
          </button>
        )}

        {loading && items.length > 0 && (
          <div style={{ textAlign: 'center', padding: '12px', color: '#9ca3af', fontSize: '13px' }}>
            Loading...
          </div>
        )}
      </div>
    </div>
  );
}
