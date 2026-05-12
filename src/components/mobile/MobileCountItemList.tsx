'use client';

import { useState, useRef, useEffect } from 'react';
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
    unit_of_measure?: string;
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

  return (
    <div className="pb-4">
      {/* Search */}
      <div className="px-5 py-3 bg-white/80 backdrop-blur-sm sticky top-[116px] z-[5] border-b border-gray-200">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="search"
            placeholder="Search items..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-gray-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-colors"
          />
        </div>
      </div>

      {/* Items */}
      <div className="px-4 pt-3 space-y-3">
        {filtered.map((line) => {
          const isSerialized = line.catalog_item?.tracking_mode === 'serialized';
          const isHighlighted = highlightItemId === line.catalog_item_id;

          return (
            <div
              key={line.id}
              ref={isHighlighted ? highlightRef : undefined}
              className={`transition-shadow duration-300 ${isHighlighted ? 'ring-2 ring-blue-500 ring-offset-2 rounded-2xl' : ''}`}
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
          <div className="text-center py-12 text-gray-400">
            <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
            <p className="text-sm font-medium">{search ? 'No matching items' : 'No items to count'}</p>
          </div>
        )}
      </div>
    </div>
  );
}
