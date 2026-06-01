'use client';

import { useState, type CSSProperties } from 'react';

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
  onAddSerial?: (lineId: string, serial: string) => Promise<void>;
  onScanSerial?: (lineId: string) => void;
}

export function MobileCountAssetRow({ line, onRecordAssets, onAddSerial, onScanSerial }: MobileCountAssetRowProps) {
  const [saving, setSaving] = useState(false);
  const [serialInput, setSerialInput] = useState('');
  const [adding, setAdding] = useState(false);
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

  const cardStyle: CSSProperties = {
    borderRadius: '16px',
    border: allFound ? '1px solid #bbf7d0' : '1px solid #e5e7eb',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    overflow: 'hidden',
    transition: 'border-color 0.2s',
  };

  const headerStyle: CSSProperties = {
    padding: '12px 16px',
    background: allFound ? '#f0fdf4' : '#fff',
  };

  const headerRow: CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  };

  const itemName: CSSProperties = {
    fontWeight: 600,
    fontSize: '15px',
    color: '#111827',
    lineHeight: 1.3,
    margin: 0,
  };

  const skuStyle: CSSProperties = {
    fontSize: '12px',
    color: '#6b7280',
    marginTop: '2px',
    fontFamily: 'ui-monospace, monospace',
  };

  const countBadge: CSSProperties = {
    fontSize: '12px',
    fontWeight: 600,
    padding: '4px 10px',
    borderRadius: '9999px',
    marginLeft: '12px',
    background: allFound ? '#dcfce7' : '#f3f4f6',
    color: allFound ? '#15803d' : '#4b5563',
    whiteSpace: 'nowrap',
  };

  const assetListStyle: CSSProperties = {
    padding: '4px 12px 12px',
    background: '#f9fafb',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  };

  const emptyStyle: CSSProperties = {
    fontSize: '12px',
    color: '#9ca3af',
    textAlign: 'center',
    padding: '16px 0',
  };

  return (
    <div style={cardStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={headerRow}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={itemName}>
              {line.catalog_item?.name || 'Unknown Item'}
            </div>
            {line.catalog_item?.sku && (
              <div style={skuStyle}>{line.catalog_item.sku}</div>
            )}
          </div>
          <div style={countBadge}>
            {foundCount}/{assets.length}
          </div>
        </div>
      </div>

      {/* Asset list */}
      <div style={assetListStyle}>
        {assets.map((asset) => {
          const isChecked = countedIds.has(asset.id);

          const btnStyle: CSSProperties = {
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '14px',
            borderRadius: '12px',
            textAlign: 'left',
            border: isChecked ? '1px solid #86efac' : '1px solid #e5e7eb',
            background: isChecked ? '#f0fdf4' : '#fff',
            boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
            transition: 'background 0.15s, border-color 0.15s',
            opacity: saving ? 0.7 : 1,
            fontSize: '14px',
          };

          const checkboxStyle: CSSProperties = {
            width: '28px',
            height: '28px',
            borderRadius: '8px',
            border: isChecked ? '2px solid #22c55e' : '2px solid #d1d5db',
            background: isChecked ? '#22c55e' : '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            transition: 'background 0.15s, border-color 0.15s',
          };

          return (
            <button
              key={asset.id}
              onClick={() => toggleAsset(asset.id)}
              disabled={saving}
              className="m-asset-btn"
              style={btnStyle}
            >
              <div style={checkboxStyle}>
                {isChecked && (
                  <svg width="16" height="16" fill="none" stroke="#fff" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '14px', fontWeight: 600, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {asset.asset_tag || asset.serial_number || 'Unnamed Asset'}
                </div>
                <div style={{ fontSize: '12px', color: '#6b7280', textTransform: 'capitalize', marginTop: '1px' }}>
                  {asset.status}
                </div>
              </div>
            </button>
          );
        })}

        {assets.length === 0 && (
          <div style={emptyStyle}>
            No serials recorded yet — scan or enter one below to add it.
          </div>
        )}

        {/* Scan / add a serial that isn't yet in the system. */}
        {(onAddSerial || onScanSerial) && (
          <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
            {onScanSerial && (
              <button
                type="button"
                onClick={() => onScanSerial(line.id)}
                disabled={adding}
                style={{
                  flexShrink: 0, padding: '10px 12px', borderRadius: '10px',
                  border: '1px solid #d1d5db', background: '#fff', fontSize: '13px',
                  fontWeight: 600, color: '#374151', cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
                }}
              >
                Scan
              </button>
            )}
            {onAddSerial && (
              <>
                <input
                  type="text"
                  value={serialInput}
                  onChange={(e) => setSerialInput(e.target.value)}
                  placeholder="Enter serial / tag"
                  inputMode="text"
                  autoCapitalize="characters"
                  style={{
                    flex: 1, minWidth: 0, padding: '10px 12px', borderRadius: '10px',
                    border: '1px solid #d1d5db', background: '#fff', fontSize: '14px',
                  }}
                />
                <button
                  type="button"
                  disabled={adding || !serialInput.trim()}
                  onClick={async () => {
                    if (!serialInput.trim()) return;
                    setAdding(true);
                    try {
                      await onAddSerial(line.id, serialInput.trim());
                      setSerialInput('');
                    } finally {
                      setAdding(false);
                    }
                  }}
                  style={{
                    flexShrink: 0, padding: '10px 14px', borderRadius: '10px', border: 'none',
                    background: '#2563eb', color: '#fff', fontSize: '13px', fontWeight: 600,
                    cursor: 'pointer', opacity: adding || !serialInput.trim() ? 0.6 : 1,
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  {adding ? '…' : 'Add'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
