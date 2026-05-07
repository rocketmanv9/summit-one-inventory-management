'use client';

import { useState, useRef, useCallback } from 'react';

interface CountLine {
  id: string;
  catalog_item_id: string;
  catalog_item?: {
    name: string;
    sku?: string;
    unit_of_measure?: string;
  };
  qty_expected: number;
  qty_counted: number | null;
}

interface MobileCountItemRowProps {
  line: CountLine;
  isBlind: boolean;
  onRecordCount: (catalogItemId: string, qty: number) => Promise<void>;
}

export function MobileCountItemRow({ line, isBlind, onRecordCount }: MobileCountItemRowProps) {
  const [value, setValue] = useState(line.qty_counted?.toString() ?? '');
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const isCounted = line.qty_counted !== null;

  const save = useCallback(async (qty: string) => {
    const num = parseFloat(qty);
    if (isNaN(num) || num < 0) return;

    setSaving(true);
    try {
      await onRecordCount(line.catalog_item_id, num);
    } finally {
      setSaving(false);
    }
  }, [line.catalog_item_id, onRecordCount]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setValue(val);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (val !== '' && !isNaN(parseFloat(val))) {
        save(val);
      }
    }, 800);
  };

  const handleBlur = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value !== '' && !isNaN(parseFloat(value))) {
      save(value);
    }
  };

  return (
    <div className={`p-4 bg-white rounded-lg border ${isCounted ? 'border-green-200 bg-green-50/50' : 'border-gray-200'}`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{line.catalog_item?.name || 'Unknown Item'}</div>
          <div className="text-xs text-gray-500">{line.catalog_item?.sku || ''}</div>
        </div>
        {isCounted && (
          <div className="ml-2 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0">
            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        {!isBlind && (
          <div className="text-xs text-gray-500">
            Expected: <span className="font-medium">{line.qty_expected}</span>
            {line.catalog_item?.unit_of_measure ? ` ${line.catalog_item.unit_of_measure}` : ''}
          </div>
        )}
        <div className="flex-1">
          <input
            type="number"
            inputMode="decimal"
            value={value}
            onChange={handleChange}
            onBlur={handleBlur}
            placeholder="Count"
            step="0.01"
            min="0"
            className={`w-full px-3 py-3 text-lg font-medium border rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              saving ? 'bg-blue-50 border-blue-300' : 'bg-white border-gray-300'
            }`}
          />
        </div>
      </div>
    </div>
  );
}
