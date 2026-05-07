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
      <div className="px-4 py-3 bg-white sticky top-[88px] z-5 border-b">
        <input
          type="search"
          placeholder="Search items..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-2.5 bg-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Items */}
      <div className="px-4 pt-2 space-y-2">
        {filtered.map((line) => {
          const isSerialized = line.catalog_item?.tracking_mode === 'serialized';
          const isHighlighted = highlightItemId === line.catalog_item_id;

          return (
            <div
              key={line.id}
              ref={isHighlighted ? highlightRef : undefined}
              className={isHighlighted ? 'ring-2 ring-blue-500 rounded-lg' : ''}
            >
              {isSerialized ? (
                <MobileCountAssetRow
                  line={line}
                  onRecordAssets={onRecordAssets}
                />
              ) : (
                <MobileCountItemRow
                  line={line}
                  isBlind={isBlind}
                  onRecordCount={onRecordCount}
                />
              )}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="text-center py-8 text-gray-500 text-sm">
            {search ? 'No matching items found' : 'No items to count'}
          </div>
        )}
      </div>
    </div>
  );
}
