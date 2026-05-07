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
    <div className="p-4 bg-white rounded-lg border border-gray-200">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{line.catalog_item?.name || 'Unknown Item'}</div>
          <div className="text-xs text-gray-500">{line.catalog_item?.sku || ''}</div>
        </div>
        <div className="text-xs text-gray-500 ml-2">
          {foundCount} / {assets.length} found
        </div>
      </div>

      <div className="space-y-1">
        {assets.map((asset) => {
          const isChecked = countedIds.has(asset.id);
          return (
            <button
              key={asset.id}
              onClick={() => toggleAsset(asset.id)}
              disabled={saving}
              className={`w-full flex items-center gap-3 p-3 rounded-lg text-left transition-colors ${
                isChecked
                  ? 'bg-green-50 border border-green-200'
                  : 'bg-gray-50 border border-gray-200'
              }`}
            >
              <div className={`w-6 h-6 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                isChecked ? 'bg-green-500 border-green-500' : 'border-gray-300'
              }`}>
                {isChecked && (
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {asset.asset_tag || asset.serial_number || 'Unnamed Asset'}
                </div>
                <div className="text-xs text-gray-500">{asset.status}</div>
              </div>
            </button>
          );
        })}

        {assets.length === 0 && (
          <div className="text-xs text-gray-500 text-center py-2">
            No assets expected at this location
          </div>
        )}
      </div>
    </div>
  );
}
