'use client';

import { useState, useRef, useEffect, type CSSProperties } from 'react';
import { MobileCountItemRow } from './MobileCountItemRow';
import { MobileCountAssetRow } from './MobileCountAssetRow';

interface CountLine {
  id: string;
  catalog_item_id: string;
  catalog_item?: {
    name: string;
    sku?: string;
    barcode?: string;
    tracking_mode?: string;
    uom_term_id?: string;
    parent_item_id?: string | null;
    parent_name?: string | null;
    variant_attributes?: Record<string, string> | null;
  };
  qty_expected: number;
  qty_counted: number | null;
  expected_assets?: Array<{
    id: string;
    asset_tag?: string;
    serial_number?: string;
    status: string;
  }>;
  counted_assets?: Array<{
    asset_id: string;
  }>;
}

interface MobileCountItemListProps {
  lines: CountLine[];
  isBlind: boolean;
  highlightItemId?: string | null;
  onRecordCount: (catalogItemId: string, qty: number) => Promise<void>;
  onRecordAssets: (lineId: string, assetIds: string[]) => Promise<void>;
}

export function MobileCountItemList({
  lines,
  isBlind,
  highlightItemId,
  onRecordCount,
  onRecordAssets,
}: MobileCountItemListProps) {
  const [search, setSearch] = useState('');
  const highlightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (highlightItemId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightItemId]);

  const filtered = lines.filter((line) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      line.catalog_item?.name?.toLowerCase().includes(q) ||
      line.catalog_item?.sku?.toLowerCase().includes(q) ||
      line.catalog_item?.barcode?.toLowerCase().includes(q)
    );
  });

  const s: Record<string, CSSProperties> = {
    container: {
      paddingBottom: '16px',
    },
    searchBar: {
      padding: '12px 20px',
      background: 'rgba(255,255,255,0.95)',
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
      position: 'sticky',
      top: 0,
      zIndex: 5,
      borderBottom: '1px solid #e5e7eb',
    },
    searchWrapper: {
      position: 'relative',
    },
    searchIcon: {
      position: 'absolute',
      left: '12px',
      top: '50%',
      transform: 'translateY(-50%)',
      pointerEvents: 'none',
    },
    searchInput: {
      width: '100%',
      paddingLeft: '40px',
      paddingRight: '16px',
      paddingTop: '12px',
      paddingBottom: '12px',
      background: '#f3f4f6',
      borderRadius: '12px',
      fontSize: '14px',
      border: 'none',
      WebkitAppearance: 'none',
      appearance: 'none' as any,
    },
    listWrapper: {
      padding: '12px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
    },
    highlightRing: {
      boxShadow: '0 0 0 2px #3b82f6, 0 0 0 4px rgba(59,130,246,0.3)',
      borderRadius: '16px',
    },
    emptyState: {
      textAlign: 'center',
      padding: '48px 0',
      color: '#9ca3af',
    },
    emptyText: {
      fontSize: '14px',
      fontWeight: 500,
      marginTop: '12px',
    },
  };

  return (
    <div style={s.container}>
      {/* Search */}
      <div style={s.searchBar}>
        <div style={s.searchWrapper}>
          <div style={s.searchIcon}>
            <svg width="16" height="16" fill="none" stroke="#9ca3af" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <input
            type="search"
            placeholder="Search items..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="m-search"
            style={s.searchInput}
          />
        </div>
      </div>

      {/* Items */}
      <div style={s.listWrapper}>
        {filtered.map((line) => {
          const isSerialized = line.catalog_item?.tracking_mode === 'serialized';
          const isHighlighted = highlightItemId === line.catalog_item_id;

          return (
            <div
              key={line.id}
              ref={isHighlighted ? highlightRef : undefined}
              style={isHighlighted ? s.highlightRing : undefined}
            >
              {isSerialized ? (
                <MobileCountAssetRow line={line} onRecordAssets={onRecordAssets} />
              ) : (
                <MobileCountItemRow line={line} isBlind={isBlind} onRecordCount={onRecordCount} />
              )}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div style={s.emptyState}>
            <svg width="48" height="48" fill="none" stroke="#d1d5db" viewBox="0 0 24 24" style={{ margin: '0 auto' }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
            <p style={s.emptyText}>{search ? 'No matching items' : 'No items to count'}</p>
          </div>
        )}
      </div>
    </div>
  );
}
