'use client';

import { useState, useRef, useEffect, useCallback, type CSSProperties } from 'react';
import { useUOMLabelMap } from '@/hooks/useGVTerms';

interface CountLine {
  id: string;
  catalog_item_id: string;
  catalog_item?: {
    name: string;
    sku?: string;
    uom_term_id?: string;
    parent_item_id?: string | null;
    parent_name?: string | null;
    variant_attributes?: Record<string, string> | null;
  };
  qty_expected: number;
  qty_counted: number | null;
}

interface MobileCountItemRowProps {
  line: CountLine;
  isBlind: boolean;
  isInitial?: boolean;
  onRecordCount: (catalogItemId: string, qty: number) => Promise<boolean | void>;
}

export function MobileCountItemRow({ line, isBlind, isInitial = false, onRecordCount }: MobileCountItemRowProps) {
  const uomLabels = useUOMLabelMap();
  const [value, setValue] = useState(line.qty_counted?.toString() ?? '');
  const [saving, setSaving] = useState(false);
  const [focused, setFocused] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const isCounted = line.qty_counted !== null;
  const variance = isCounted ? (line.qty_counted ?? 0) - line.qty_expected : 0;
  const showVariance = !isBlind && !isInitial && isCounted && variance !== 0;

  // Scans update qty_counted from outside this row. Sync the input whenever
  // the user isn't actively typing, so a later blur can't re-save a stale
  // number over the scanned quantity.
  useEffect(() => {
    if (focused) return;
    const propVal = line.qty_counted == null ? '' : String(line.qty_counted);
    setValue((current) => (current === propVal ? current : propVal));
  }, [line.qty_counted, focused]);

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

  const scheduleSave = useCallback((val: string, delayMs: number) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (val !== '' && !isNaN(parseFloat(val))) {
        save(val);
      }
    }, delayMs);
  }, [save]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setValue(val);
    scheduleSave(val, 800);
  };

  const handleBlur = () => {
    setFocused(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value !== '' && !isNaN(parseFloat(value))) {
      save(value);
    }
  };

  // Big-thumb +/- buttons: adjust by whole units, save shortly after the last
  // tap so a burst of taps becomes one write.
  const handleStep = (delta: number) => {
    try { navigator.vibrate?.(10); } catch { /* unsupported */ }
    const current = parseFloat(value);
    const base = isNaN(current) ? (line.qty_counted ?? 0) : current;
    const next = Math.max(0, Math.round((base + delta) * 100) / 100);
    const nextStr = String(next);
    setValue(nextStr);
    scheduleSave(nextStr, 450);
  };

  const cardStyle: CSSProperties = {
    padding: '16px',
    borderRadius: '16px',
    border: isCounted ? '1px solid #bbf7d0' : '1px solid #e5e7eb',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    background: isCounted ? '#f0fdf4' : '#fff',
    transition: 'background 0.2s, border-color 0.2s',
  };

  const headerRow: CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: '12px',
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

  const checkCircle: CSSProperties = {
    width: '24px',
    height: '24px',
    background: '#22c55e',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
  };

  const varianceChip: CSSProperties = {
    fontSize: '12px',
    fontWeight: 700,
    padding: '3px 8px',
    borderRadius: '9999px',
    background: '#fef3c7',
    color: '#92400e',
    border: '1px solid #fde68a',
    whiteSpace: 'nowrap',
  };

  const inputRow: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  };

  const expectedBadge: CSSProperties = {
    fontSize: '12px',
    color: '#6b7280',
    background: '#f3f4f6',
    padding: '6px 10px',
    borderRadius: '8px',
    whiteSpace: 'nowrap',
  };

  const expectedValue: CSSProperties = {
    fontWeight: 600,
    color: '#374151',
  };

  const stepBtn = (disabled: boolean): CSSProperties => ({
    width: '48px',
    height: '52px',
    flexShrink: 0,
    borderRadius: '12px',
    border: '2px solid #d1d5db',
    background: disabled ? '#f3f4f6' : '#fff',
    color: disabled ? '#d1d5db' : '#374151',
    fontSize: '24px',
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: disabled ? 'default' : 'pointer',
    WebkitTapHighlightColor: 'transparent',
    touchAction: 'manipulation',
    userSelect: 'none' as const,
  });

  const inputStyle: CSSProperties = {
    width: '100%',
    padding: '14px 8px',
    fontSize: '20px',
    fontWeight: 700,
    border: saving
      ? '2px solid #60a5fa'
      : isCounted
      ? '2px solid #86efac'
      : '2px solid #d1d5db',
    borderRadius: '12px',
    textAlign: 'center',
    background: saving ? '#eff6ff' : '#fff',
    color: saving ? '#1d4ed8' : isCounted ? '#15803d' : '#111827',
    WebkitAppearance: 'none',
    MozAppearance: 'textfield' as any,
    appearance: 'none' as any,
    transition: 'border-color 0.2s, background 0.2s',
  };

  const minusDisabled = (parseFloat(value) || 0) <= 0 && !isCounted;

  return (
    <div style={cardStyle}>
      <div style={headerRow}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {line.catalog_item?.parent_name && (
            <div style={{ fontSize: '11px', color: '#9ca3af', fontWeight: 500, marginBottom: '2px' }}>
              {line.catalog_item.parent_name}
            </div>
          )}
          <div style={itemName}>
            {line.catalog_item?.name || 'Unknown Item'}
          </div>
          {line.catalog_item?.sku && (
            <div style={skuStyle}>{line.catalog_item.sku}</div>
          )}
          {line.catalog_item?.variant_attributes && (
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px' }}>
              {Object.entries(line.catalog_item.variant_attributes).map(([k, v]) => (
                <span key={k} style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: '#ede9fe', color: '#6d28d9', fontWeight: 500 }}>
                  {k}: {v}
                </span>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '12px' }}>
          {showVariance && (
            <span style={varianceChip}>{variance > 0 ? `+${variance}` : variance}</span>
          )}
          {isCounted && (
            <div style={checkCircle}>
              <svg width="14" height="14" fill="none" stroke="#fff" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          )}
        </div>
      </div>

      <div style={inputRow}>
        {!isBlind && (isInitial ? line.qty_expected > 0 : true) && (
          <div style={expectedBadge}>
            Exp: <span style={expectedValue}>{line.qty_expected}</span>
            {line.catalog_item?.uom_term_id ? ` ${uomLabels[line.catalog_item.uom_term_id] || ''}` : ''}
          </div>
        )}
        <button
          type="button"
          className="m-btn"
          aria-label="Decrease quantity"
          onClick={() => handleStep(-1)}
          disabled={minusDisabled}
          style={stepBtn(minusDisabled)}
        >
          −
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <input
            type="number"
            inputMode="decimal"
            value={value}
            onChange={handleChange}
            onFocus={() => setFocused(true)}
            onBlur={handleBlur}
            placeholder="0"
            step="0.01"
            min="0"
            className={`m-input ${isCounted ? 'm-input-counted' : ''}`}
            style={inputStyle}
          />
        </div>
        <button
          type="button"
          className="m-btn"
          aria-label="Increase quantity"
          onClick={() => handleStep(1)}
          style={stepBtn(false)}
        >
          +
        </button>
      </div>
    </div>
  );
}
