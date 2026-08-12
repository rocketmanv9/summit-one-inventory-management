'use client';

import { useState, useEffect, useRef } from 'react';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { createBrowserAuthedClient } from '@/supabase/client';

// Adjustment reasons with short descriptions surfaced under the dropdown.
// 'count_variance' doubles as "Initial count" for brand-new/zero balances.
export const REASON_OPTIONS = [
  { value: 'count_variance', label: 'Initial count', description: 'Set a starting balance or correct a physical count.' },
  { value: 'damage', label: 'Damage', description: 'Write off stock that was damaged or is unusable.' },
  { value: 'theft', label: 'Theft', description: 'Record stock lost to theft or unexplained shrinkage.' },
  { value: 'expiration', label: 'Expiration', description: 'Remove stock that expired or aged out.' },
  { value: 'other', label: 'Other', description: 'Anything else — explain in the notes below.' },
] as const;

export interface AdjustStockForm {
  catalog_item_id: string;
  // When the chosen item is a variant parent, the adjustment targets a specific
  // child (size/color). variant_item_id holds that resolved child id; for plain
  // items it stays empty and we adjust catalog_item_id directly.
  variant_item_id: string;
  location_id: string;
  new_qty: string;
  reason: string;
  notes: string;
  override_reason: string;
}

export interface AdjustStockItem {
  id: string;
  name: string;
  sku: string;
  is_parent?: boolean;
  variant_dimensions?: string[] | null;
  variant_options?: Record<string, string[]> | null;
}

export type GuardrailBlock = {
  code: string;
  message: string;
  details?: Record<string, any>;
  action?: string;
} | null;

export function AdjustStockModal({
  form,
  items,
  locations,
  saving,
  error,
  guardrailBlock,
  lockItem = false,
  onClose,
  onChange,
  onSubmit,
  onBatchComplete,
}: {
  form: AdjustStockForm;
  items: AdjustStockItem[];
  locations: Array<{ id: string; name: string }>;
  saving: boolean;
  error: string;
  guardrailBlock: GuardrailBlock;
  // When true the item picker is shown read-only — used when the modal is opened
  // from a single item's page where the item is already fixed.
  lockItem?: boolean;
  onClose: () => void;
  onChange: (next: Partial<AdjustStockForm>) => void;
  onSubmit: () => void;
  // Called after a batch (all-variants) run: refreshes the stock list and, when
  // every row succeeded, closes the modal.
  onBatchComplete: (allSucceeded: boolean) => Promise<void> | void;
}) {
  const isOverrideRequired = guardrailBlock?.code === 'OVERRIDE_REASON_REQUIRED';
  const isHardBlock = !!guardrailBlock && !isOverrideRequired;

  const selectedItem = items.find((i) => i.id === form.catalog_item_id);
  const isVariantParent = selectedItem?.is_parent === true;

  // Variant children for the selected parent (size/color rows that actually
  // hold stock). Loaded on demand — getCatalogItems hides children by default.
  const [variants, setVariants] = useState<
    Array<{ id: string; name: string; sku: string; attributes: Record<string, string> }>
  >([]);
  const [loadingVariants, setLoadingVariants] = useState(false);
  // Current on-hand for the resolved target item + location, so the absolute-qty
  // field has a sensible starting value per variant.
  const [currentOnHand, setCurrentOnHand] = useState<number | null>(null);

  useEffect(() => {
    if (!isVariantParent) {
      setVariants([]);
      return;
    }
    let alive = true;
    setLoadingVariants(true);
    (async () => {
      try {
        const children = await InventoryRPC.getCatalogItems({
          active: true,
          exclude_variants: false,
          parent_item_id: form.catalog_item_id,
        });
        if (!alive) return;
        setVariants(
          (children || []).map((c: any) => ({
            id: c.id,
            name: c.name,
            sku: c.sku,
            attributes: (c.variant_attributes as Record<string, string>) ?? {},
          })),
        );
      } catch {
        if (alive) setVariants([]);
      } finally {
        if (alive) setLoadingVariants(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [isVariantParent, form.catalog_item_id]);

  // The item whose balance we'll actually write.
  const targetItemId = isVariantParent ? form.variant_item_id : form.catalog_item_id;

  useEffect(() => {
    if (!targetItemId || !form.location_id) {
      setCurrentOnHand(null);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const sb = createBrowserAuthedClient().schema('inventory');
        const { data } = await sb
          .from('stock_balances')
          .select('qty_on_hand')
          .eq('catalog_item_id', targetItemId)
          .eq('location_id', form.location_id)
          .maybeSingle();
        if (!alive) return;
        setCurrentOnHand(data ? Number((data as any).qty_on_hand) : 0);
      } catch {
        if (alive) setCurrentOnHand(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [targetItemId, form.location_id]);

  // Brand-new/zero balance → quietly default the reason to "Initial count" so
  // the common first-stock flow doesn't require an extra click. Never fights a
  // reason the user picked themselves.
  const reasonTouched = useRef(false);
  useEffect(() => {
    if (currentOnHand === 0 && !form.reason && !reasonTouched.current) {
      onChange({ reason: 'count_variance' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOnHand]);

  const variantLabel = (attributes: Record<string, string>) => {
    const vals = Object.values(attributes || {});
    return vals.length ? vals.join(' · ') : 'Variant';
  };

  // ── Batch (all-variants) mode ──────────────────────────────────────────
  // Adjust every variant of the parent in one pass. Reuses the exact same
  // rpc_adjust_inventory call as the single-variant path, looped sequentially
  // with per-row error reporting. Blank rows are skipped.
  const [batchMode, setBatchMode] = useState(false);
  const [batchQtys, setBatchQtys] = useState<Record<string, string>>({});
  const [batchOnHand, setBatchOnHand] = useState<Record<string, number>>({});
  const [batchErrors, setBatchErrors] = useState<Record<string, string>>({});
  const [batchError, setBatchError] = useState('');
  const [batchSaving, setBatchSaving] = useState(false);

  // Current on-hand per variant at the chosen location, for the batch table.
  useEffect(() => {
    if (!batchMode || !form.location_id || variants.length === 0) {
      setBatchOnHand({});
      return;
    }
    let alive = true;
    (async () => {
      try {
        const sb = createBrowserAuthedClient().schema('inventory');
        const { data } = await sb
          .from('stock_balances')
          .select('catalog_item_id, qty_on_hand')
          .eq('location_id', form.location_id)
          .in('catalog_item_id', variants.map((v) => v.id))
          .limit(variants.length);
        if (!alive) return;
        const map: Record<string, number> = {};
        for (const row of (data || []) as any[]) {
          // Postgres numeric arrives as a string via PostgREST — coerce.
          map[row.catalog_item_id] = Number(row.qty_on_hand);
        }
        setBatchOnHand(map);
      } catch {
        if (alive) setBatchOnHand({});
      }
    })();
    return () => {
      alive = false;
    };
  }, [batchMode, form.location_id, variants]);

  const toggleBatchMode = () => {
    setBatchMode((prev) => !prev);
    setBatchError('');
    setBatchErrors({});
  };

  const submitBatch = async () => {
    setBatchError('');
    setBatchErrors({});
    if (!form.location_id) {
      setBatchError('Select a location first.');
      return;
    }
    if (!form.reason) {
      setBatchError('Select a reason for this adjustment.');
      return;
    }
    const rows = variants.filter((v) => (batchQtys[v.id] ?? '') !== '');
    if (rows.length === 0) {
      setBatchError('Enter a new quantity for at least one variant.');
      return;
    }
    for (const v of rows) {
      if (!Number.isFinite(Number(batchQtys[v.id]))) {
        setBatchError(`Enter a valid quantity for ${variantLabel(v.attributes)}.`);
        return;
      }
    }

    setBatchSaving(true);
    const rowErrors: Record<string, string> = {};
    let okCount = 0;
    // Sequential on purpose — one adjustment at a time, same RPC as single mode.
    for (const v of rows) {
      try {
        const result = await InventoryRPC.adjustInventory({
          catalog_item_id: v.id,
          location_id: form.location_id,
          new_qty: Number(batchQtys[v.id]),
          reason: form.reason as 'count_variance' | 'damage' | 'theft' | 'expiration' | 'other',
          notes: form.notes,
        });
        if (!result.success && result.error) {
          rowErrors[v.id] = result.error.message
            ? `${result.error.message} Switch to single-variant mode to override.`
            : 'Blocked by a guardrail — switch to single-variant mode to override.';
        } else {
          okCount += 1;
        }
      } catch (err: any) {
        rowErrors[v.id] = err?.message || 'Failed to adjust this variant.';
      }
    }
    setBatchErrors(rowErrors);
    setBatchSaving(false);
    const allSucceeded = Object.keys(rowErrors).length === 0;
    if (!allSucceeded) {
      setBatchError(`${okCount} of ${rows.length} variants saved. Fix the rows marked below and retry.`);
    }
    if (okCount > 0 || allSucceeded) {
      await onBatchComplete(allSucceeded);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Add Starting Stock</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">x</button>
        </div>

        {error && (
          <div className="mb-3 text-sm text-red-600">{error}</div>
        )}

        {guardrailBlock && (
          <div className={`mb-3 p-3 rounded-md border ${isHardBlock ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
            <div className={`text-sm font-medium ${isHardBlock ? 'text-red-800' : 'text-amber-800'}`}>
              {guardrailBlock.message}
            </div>
            {guardrailBlock.details && (
              <div className="mt-1 text-xs text-gray-600 space-y-0.5">
                {guardrailBlock.details.current_qty !== undefined && (
                  <div>Current on-hand: <span className="font-mono">{guardrailBlock.details.current_qty}</span></div>
                )}
                {guardrailBlock.details.attempted_qty !== undefined && (
                  <div>Attempted: <span className="font-mono">{guardrailBlock.details.attempted_qty}</span></div>
                )}
                {guardrailBlock.details.delta !== undefined && (
                  <div>Change: <span className="font-mono">{guardrailBlock.details.delta > 0 ? '+' : ''}{guardrailBlock.details.delta}</span></div>
                )}
              </div>
            )}
            {guardrailBlock.action && (
              <div className={`mt-2 text-xs ${isHardBlock ? 'text-red-600' : 'text-amber-700'}`}>
                {guardrailBlock.action}
              </div>
            )}
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Item</label>
            {lockItem ? (
              <div className="w-full px-3 py-2 border rounded-md bg-muted/40 text-sm">
                {selectedItem ? `${selectedItem.name} (${selectedItem.sku})` : '—'}
              </div>
            ) : (
              <select
                value={form.catalog_item_id}
                onChange={(e) => onChange({ catalog_item_id: e.target.value, variant_item_id: '' })}
                className="w-full px-3 py-2 border rounded-md"
                disabled={isHardBlock}
              >
                <option value="">Select item...</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.sku}){item.is_parent ? ' — has variants' : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          {isVariantParent && (
            <div className="rounded-md border border-violet-200 bg-violet-50/50 p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs text-violet-800">
                  This item has variants — pick which one to adjust. Each variant
                  tracks its own stock.
                </p>
                <button
                  type="button"
                  onClick={toggleBatchMode}
                  disabled={isHardBlock || batchSaving}
                  className="shrink-0 text-xs font-medium text-violet-700 hover:text-violet-900 underline disabled:opacity-50"
                >
                  {batchMode ? 'Adjust one variant' : 'Adjust all variants'}
                </button>
              </div>

              {!batchMode ? (
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Variant{selectedItem?.variant_dimensions?.length
                      ? ` (${selectedItem.variant_dimensions.join(', ')})`
                      : ''}{' '}
                    <span className="text-red-600">*</span>
                  </label>
                  <select
                    value={form.variant_item_id}
                    onChange={(e) => onChange({ variant_item_id: e.target.value, new_qty: '' })}
                    className="w-full px-3 py-2 border rounded-md bg-white"
                    disabled={isHardBlock || loadingVariants}
                  >
                    <option value="">
                      {loadingVariants ? 'Loading variants…' : 'Select variant…'}
                    </option>
                    {variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {variantLabel(v.attributes)} ({v.sku})
                      </option>
                    ))}
                  </select>
                  {!form.variant_item_id && !loadingVariants && (
                    <p className="mt-1 text-xs text-red-600">
                      Select which variant to adjust before saving.
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {batchError && (
                    <div className="text-sm text-red-600">{batchError}</div>
                  )}
                  {!form.location_id ? (
                    <p className="text-xs text-violet-700">
                      Select a location below to load current quantities.
                    </p>
                  ) : loadingVariants ? (
                    <p className="text-xs text-violet-700">Loading variants…</p>
                  ) : variants.length === 0 ? (
                    <p className="text-xs text-violet-700">No variants found for this item.</p>
                  ) : (
                    <>
                      <div className="flex items-center gap-3 px-3 text-xs font-medium uppercase tracking-wide text-violet-700">
                        <span className="flex-1">Variant</span>
                        <span className="w-16 text-right">On Hand</span>
                        <span className="w-24">New Qty</span>
                      </div>
                      <div className="max-h-56 overflow-y-auto rounded-md border bg-white divide-y">
                        {variants.map((v) => (
                          <div key={v.id} className="px-3 py-1.5">
                            <div className="flex items-center gap-3">
                              <span className="flex-1 text-sm truncate" title={v.sku}>
                                {variantLabel(v.attributes)}
                                <span className="ml-1 text-xs text-muted-foreground font-mono">({v.sku})</span>
                              </span>
                              <span
                                className="w-16 text-right text-sm font-mono text-muted-foreground"
                                title="Current on hand at the selected location"
                              >
                                {batchOnHand[v.id] ?? 0}
                              </span>
                              <input
                                type="number"
                                value={batchQtys[v.id] ?? ''}
                                onChange={(e) =>
                                  setBatchQtys((prev) => ({ ...prev, [v.id]: e.target.value }))
                                }
                                placeholder={String(batchOnHand[v.id] ?? 0)}
                                className="w-24 px-2 py-1 border rounded-md text-sm font-mono"
                                disabled={batchSaving}
                              />
                            </div>
                            {batchErrors[v.id] && (
                              <p className="mt-1 text-xs text-red-600">{batchErrors[v.id]}</p>
                            )}
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-violet-700">
                        Enter the new absolute count per variant. Leave a row blank to skip it.
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">Location</label>
            <select
              value={form.location_id}
              onChange={(e) => onChange({ location_id: e.target.value })}
              className="w-full px-3 py-2 border rounded-md"
              disabled={isHardBlock}
            >
              <option value="">Select location...</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          </div>

          {!(isVariantParent && batchMode) && (
            <div>
              <label className="block text-sm font-medium mb-1">On Hand Quantity</label>
              <input
                type="number"
                value={form.new_qty}
                onChange={(e) => onChange({ new_qty: e.target.value })}
                className="w-full px-3 py-2 border rounded-md"
                disabled={isHardBlock || (isVariantParent && !form.variant_item_id)}
              />
              {currentOnHand !== null && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Current on hand here: <span className="font-mono">{currentOnHand}</span>
                  {' '}— enter the new absolute count.
                </p>
              )}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">
              Reason <span className="text-red-600">*</span>
            </label>
            <select
              value={form.reason}
              onChange={(e) => {
                reasonTouched.current = true;
                onChange({ reason: e.target.value });
              }}
              className="w-full px-3 py-2 border rounded-md"
              disabled={isHardBlock}
            >
              <option value="">-- Select reason --</option>
              {REASON_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            {form.reason && (
              <p className="mt-1 text-xs text-muted-foreground">
                {REASON_OPTIONS.find((r) => r.value === form.reason)?.description}
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => onChange({ notes: e.target.value })}
              className="w-full px-3 py-2 border rounded-md"
              rows={3}
              disabled={isHardBlock}
            />
          </div>

          {isOverrideRequired && (
            <div>
              <label className="block text-sm font-medium mb-1 text-amber-800">
                Override Reason (required) *
              </label>
              <textarea
                value={form.override_reason}
                onChange={(e) => onChange({ override_reason: e.target.value })}
                className="w-full px-3 py-2 border border-amber-300 rounded-md bg-amber-50 focus:ring-amber-500 focus:border-amber-500"
                rows={2}
                placeholder="Explain why negative inventory is acceptable for this adjustment..."
                autoFocus
              />
            </div>
          )}
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border rounded-md text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          {!isHardBlock && (
            <button
              onClick={isVariantParent && batchMode ? submitBatch : onSubmit}
              disabled={
                isVariantParent && batchMode
                  ? batchSaving
                  : saving ||
                    (isOverrideRequired && !form.override_reason.trim()) ||
                    (isVariantParent && !form.variant_item_id)
              }
              className={`flex-1 px-4 py-2 text-white rounded-md disabled:opacity-50 ${
                isOverrideRequired
                  ? 'bg-amber-600 hover:bg-amber-700'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {isVariantParent && batchMode
                ? batchSaving ? 'Saving variants…' : 'Save All Variants'
                : saving ? 'Saving...' : isOverrideRequired ? 'Override & Save' : 'Save'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
