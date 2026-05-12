'use client';

import { useState } from 'react';

interface Asset {
  id: string;
  asset_tag?: string;
  serial_number?: string;
  status: string;
}

interface CountLine {
  id: string;
  catalog_item_id: string;
  catalog_item?: {
    name: string;
    sku?: string;
  };
  qty_expected: number;
  qty_counted: number | null;
  expected_assets?: Asset[];
  counted_assets?: Array<{ asset_id: string }>;
}

interface MobileCountAssetRowProps {
  line: CountLine;
  onRecordAssets: (lineId: string, assetIds: string[]) => Promise<void>;
}

export function MobileCountAssetRow({ line, onRecordAssets }: MobileCountAssetRowProps) {
  const [saving, setSaving] = useState(false);
  const countedIds = new Set(line.counted_assets?.map((ca) => ca.asset_id) || []);
  const assets = line.expected_assets || [];
  const foundCount = countedIds.size;
  const allFound = foundCount === assets.length && assets.length > 0;

  const toggleAsset = async (assetId: string) => {
    const currentIds = Array.from(countedIds);
    const newIds = countedIds.has(assetId)
      ? currentIds.filter((id) => id !== assetId)
      : [...currentIds, assetId];

    setSaving(true);
    try {
      await onRecordAssets(line.id, newIds);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`rounded-2xl border shadow-sm overflow-hidden transition-colors ${
      allFound ? 'border-green-200' : 'border-gray-200'
    }`}>
      {/* Header */}
      <div className={`px-4 py-3 ${allFound ? 'bg-green-50' : 'bg-white'}`}>
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-[15px] text-gray-900 leading-tight">
              {line.catalog_item?.name || 'Unknown Item'}
            </div>
            {line.catalog_item?.sku && (
              <div className="text-xs text-gray-500 mt-0.5 font-mono">{line.catalog_item.sku}</div>
            )}
          </div>
          <div className={`text-xs font-semibold px-2.5 py-1 rounded-full ml-3 ${
            allFound
              ? 'bg-green-100 text-green-700'
              : 'bg-gray-100 text-gray-600'
          }`}>
            {foundCount}/{assets.length}
          </div>
        </div>
      </div>

      {/* Asset list */}
      <div className="px-3 pb-3 pt-1 space-y-1.5 bg-gray-50">
        {assets.map((asset) => {
          const isChecked = countedIds.has(asset.id);
          return (
            <button
              key={asset.id}
              onClick={() => toggleAsset(asset.id)}
              disabled={saving}
              className={`w-full flex items-center gap-3 p-3.5 rounded-xl text-left transition-all active:scale-[0.98] ${
                isChecked
                  ? 'bg-green-50 border border-green-300 shadow-sm'
                  : 'bg-white border border-gray-200 shadow-sm'
              }`}
            >
              <div className={`w-7 h-7 rounded-lg border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                isChecked ? 'bg-green-500 border-green-500' : 'border-gray-300 bg-white'
              }`}>
                {isChecked && (
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-gray-900 truncate">
                  {asset.asset_tag || asset.serial_number || 'Unnamed Asset'}
                </div>
                <div className="text-xs text-gray-500 capitalize">{asset.status}</div>
              </div>
            </button>
          );
        })}

        {assets.length === 0 && (
          <div className="text-xs text-gray-400 text-center py-4">
            No assets expected at this location
          </div>
        )}
      </div>
    </div>
  );
}
