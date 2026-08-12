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
  isInitial?: boolean;
  highlightItemId?: string | null;
  onRecordCount: (catalogItemId: string, qty: number) => Promise<boolean | void>;
  onRecordAssets: (lineId: string, assetIds: string[]) => Promise<void>;
  onAddSerial?: (lineId: string, serial: string) => Promise<void>;
  onScanSerial?: (lineId: string) => void;
  onMarkPresent?: (lineId: string) => Promise<void>;
}

type CountFilter = 'all' | 'remaining' | 'counted';

export function MobileCountItemList({
  lines,
  isBlind,
  isInitial = false,
  highlightItemId,
  onRecordCount,
  onRecordAssets,
  onAddSerial,
  onScanSerial,
  onMarkPresent,
}: MobileCountItemListProps) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<CountFilter>('all');
  const highlightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (highlightItemId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightItemId]);

  const remainingCount = lines.filter((l) => l.qty_counted === null).length;
  const countedCount = lines.length - remainingCount;

  const filtered = lines.filter((line) => {
    if (filter === 'remaining' && line.qty_counted !== null) return false;
    if (filter === 'counted' && line.qty_counted === null) return false;
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

        {/* Quick filters — find what's left without scrolling a long list */}
        {lines.length > 0 && (
          <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
            {([
              ['all', `All (${lines.length})`],
              ['remaining', `Remaining (${remainingCount})`],
              ['counted', `Counted (${countedCount})`],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className="m-btn"
                onClick={() => setFilter(key)}
                style={{
                  flex: 1,
                  padding: '8px 4px',
                  borderRadius: '9999px',
                  fontSize: '12px',
                  fontWeight: 600,
                  border: filter === key ? '1.5px solid #2563eb' : '1.5px solid #e5e7eb',
                  background: filter === key ? '#eff6ff' : '#fff',
                  color: filter === key ? '#1d4ed8' : '#6b7280',
                  cursor: 'pointer',
                  WebkitTapHighlightColor: 'transparent',
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
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
                <MobileCountAssetRow line={line} onRecordAssets={onRecordAssets} onAddSerial={onAddSerial} onScanSerial={onScanSerial} onMarkPresent={onMarkPresent} />
              ) : (
                <MobileCountItemRow line={line} isBlind={isBlind} isInitial={isInitial} onRecordCount={onRecordCount} />
              )}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div style={s.emptyState}>
            <svg width="48" height="48" fill="none" stroke="#d1d5db" viewBox="0 0 24 24" style={{ margin: '0 auto' }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
            <p style={s.emptyText}>
              {search
                ? 'No matching items'
                : filter === 'remaining'
                ? 'Everything is counted — ready to submit! 🎉'
                : filter === 'counted'
                ? 'Nothing counted yet'
                : isInitial
                ? 'Scan a barcode, or use Search / Browse above to count your first item'
                : 'No items to count'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
