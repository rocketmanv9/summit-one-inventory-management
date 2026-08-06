'use client';

/**
 * Min-level wizard (automagic 01).
 *
 * Full-screen review of AI-proposed min_stock_level / reorder_point /
 * reorder_qty for every stock item, grouped by category. Each row shows the
 * item's on-hand and 30/90-day usage next to the proposal and a one-line
 * rationale; the three level fields are editable inline. Accept a row,
 * accept a whole category, or accept everything — skipped items are left
 * untouched. Items without enough history show "not enough history" and can't
 * be accepted (nothing to write).
 *
 * Proposals come from POST /api/ai/min-levels (read-only). Writes go only
 * through POST /api/inventory/min-levels on explicit accept, carrying each
 * item's expected_last_event_id for optimistic concurrency.
 */

import { useEffect, useMemo, useState } from 'react';
import { apiWrite, authenticatedFetch } from '@/lib/api-client';
import { Sparkles, Loader2, Check, X, AlertTriangle } from 'lucide-react';

interface Proposal {
  catalog_item_id: string;
  sku: string;
  name: string;
  category_name: string | null;
  uom_label: string | null;
  tracking_mode: string;
  last_event_id: string;
  qty_on_hand: number;
  qty_available: number;
  usage_30d: number;
  usage_90d: number;
  current_reorder_point: number | null;
  current_min_stock_level: number | null;
  classification: 'steady' | 'sporadic' | 'serialized' | 'dead';
  min_stock_level: number | null;
  reorder_point: number | null;
  reorder_qty: number | null;
  rationale: string;
  enough_history: boolean;
}

interface Summary {
  total: number;
  with_history: number;
  no_history: number;
  proposed: number;
  model_calls: number;
}

// Local editable copy of a proposal's three levels, as strings for the inputs.
interface EditState {
  min: string;
  rop: string;
  qty: string;
  accepted: boolean;
}

const CLASS_LABEL: Record<Proposal['classification'], string> = {
  steady: 'Steady',
  sporadic: 'Sporadic',
  serialized: 'Serialized',
  dead: 'No movement',
};
const CLASS_COLOR: Record<Proposal['classification'], string> = {
  steady: 'bg-green-100 text-green-800',
  sporadic: 'bg-amber-100 text-amber-800',
  serialized: 'bg-violet-100 text-violet-800',
  dead: 'bg-gray-100 text-gray-600',
};

const numOrNull = (s: string): number | null => {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export function MinLevelWizard({
  onClose,
  onAccepted,
}: {
  onClose: () => void;
  onAccepted: (appliedCount: number) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [edits, setEdits] = useState<Record<string, EditState>>({});
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ applied: number; conflicts: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await authenticatedFetch('/api/ai/min-levels', { method: 'POST', body: '{}' });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(json.error?.message || json.error || 'Failed to get proposals.');
          return;
        }
        const props: Proposal[] = json.proposals || [];
        setProposals(props);
        setSummary(json.summary || null);
        const initial: Record<string, EditState> = {};
        for (const p of props) {
          initial[p.catalog_item_id] = {
            min: p.min_stock_level != null ? String(p.min_stock_level) : '',
            rop: p.reorder_point != null ? String(p.reorder_point) : '',
            qty: p.reorder_qty != null ? String(p.reorder_qty) : '',
            // Pre-select rows that have a real proposal so "Accept all" is one click.
            accepted: p.enough_history && (p.reorder_point != null || p.min_stock_level != null),
          };
        }
        setEdits(initial);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to get proposals.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Category → proposals, preserving the server's category-grouped order.
  const grouped = useMemo(() => {
    const map = new Map<string, Proposal[]>();
    for (const p of proposals) {
      const key = p.category_name || 'Uncategorized';
      const list = map.get(key) || [];
      list.push(p);
      map.set(key, list);
    }
    return Array.from(map.entries());
  }, [proposals]);

  const setEdit = (id: string, patch: Partial<EditState>) =>
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  // A row can be accepted only if it has history AND at least one level field
  // currently holds a value. This keeps "dead"/no-proposal rows (all fields
  // blank) out of Accept-all, so we never sweep in a null that would clear an
  // item's existing config. A user can still opt one in by typing a value.
  const hasAnyValue = (id: string): boolean => {
    const e = edits[id];
    return !!e && (e.min.trim() !== '' || e.rop.trim() !== '' || e.qty.trim() !== '');
  };
  const canAcceptRow = (p: Proposal): boolean => p.enough_history && hasAnyValue(p.catalog_item_id);

  const acceptedCount = useMemo(
    () =>
      Object.entries(edits).filter(
        ([id, e]) => e.accepted && (e.min.trim() !== '' || e.rop.trim() !== '' || e.qty.trim() !== ''),
      ).length,
    [edits],
  );

  const setCategoryAccepted = (cat: string, accepted: boolean) => {
    const ids = (grouped.find(([c]) => c === cat)?.[1] || [])
      .filter((p) => canAcceptRow(p))
      .map((p) => p.catalog_item_id);
    setEdits((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = { ...next[id], accepted };
      return next;
    });
  };

  const setAllAccepted = (accepted: boolean) => {
    setEdits((prev) => {
      const next = { ...prev };
      for (const p of proposals) {
        if (!accepted) {
          if (next[p.catalog_item_id]) next[p.catalog_item_id] = { ...next[p.catalog_item_id], accepted: false };
          continue;
        }
        const e = next[p.catalog_item_id];
        const hasVal = e && (e.min.trim() !== '' || e.rop.trim() !== '' || e.qty.trim() !== '');
        if (p.enough_history && hasVal) next[p.catalog_item_id] = { ...e, accepted: true };
      }
      return next;
    });
  };

  const submit = async () => {
    setSaving(true);
    setError('');
    try {
      const byId = new Map(proposals.map((p) => [p.catalog_item_id, p]));
      const updates = Object.entries(edits)
        .filter(
          ([id, e]) =>
            e.accepted &&
            byId.get(id)?.enough_history &&
            (e.min.trim() !== '' || e.rop.trim() !== '' || e.qty.trim() !== ''),
        )
        .map(([id, e]) => {
          const p = byId.get(id)!;
          return {
            catalog_item_id: id,
            expected_last_event_id: p.last_event_id,
            min_stock_level: numOrNull(e.min),
            reorder_point: numOrNull(e.rop),
            reorder_qty: numOrNull(e.qty),
          };
        });

      if (updates.length === 0) {
        setError('Select at least one item to accept.');
        setSaving(false);
        return;
      }

      const res = await apiWrite('/api/inventory/min-levels', 'POST', { updates });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error?.message || json.error || 'Failed to save levels.');
        setSaving(false);
        return;
      }
      const applied = json.data?.applied_count ?? 0;
      const conflicts = json.data?.conflict_count ?? 0;
      setResult({ applied, conflicts });
      onAccepted(applied);
    } catch (err: any) {
      setError(err?.message || 'Failed to save levels.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded-lg border bg-card shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Set min levels with AI</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p>Reading velocity and count history, proposing levels…</p>
            </div>
          ) : error && proposals.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16">
              <AlertTriangle className="h-8 w-8 text-red-500" />
              <p className="text-sm text-red-600">{error}</p>
            </div>
          ) : result ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <Check className="h-10 w-10 text-green-600" />
              <p className="text-lg font-medium">
                Applied levels to {result.applied} item{result.applied === 1 ? '' : 's'}.
              </p>
              {result.conflicts > 0 && (
                <p className="text-sm text-amber-700">
                  {result.conflicts} item{result.conflicts === 1 ? '' : 's'} changed since load and
                  {result.conflicts === 1 ? ' was' : ' were'} skipped — reopen to retry those.
                </p>
              )}
              <p className="text-sm text-muted-foreground">
                Low Stock alerts now reflect these thresholds.
              </p>
              <button
                onClick={onClose}
                className="mt-2 rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              {summary && (
                <p className="mb-3 text-sm text-muted-foreground">
                  {summary.with_history} of {summary.total} items had enough history to propose levels
                  {summary.no_history > 0 && (
                    <> · {summary.no_history} need more usage before AI can suggest a level</>
                  )}
                  . Review, edit inline, and accept the ones you want — nothing is written until you accept.
                </p>
              )}

              <div className="space-y-5">
                {grouped.map(([cat, rows]) => {
                  const proposable = rows.filter((r) => r.enough_history);
                  return (
                    <div key={cat} className="rounded-lg border">
                      <div className="flex items-center justify-between bg-muted/40 px-4 py-2">
                        <h3 className="text-sm font-semibold">
                          {cat}{' '}
                          <span className="font-normal text-muted-foreground">({rows.length})</span>
                        </h3>
                        {proposable.length > 0 && (
                          <div className="flex gap-2 text-xs">
                            <button
                              onClick={() => setCategoryAccepted(cat, true)}
                              className="rounded border px-2 py-1 hover:bg-muted"
                            >
                              Accept all in {cat}
                            </button>
                            <button
                              onClick={() => setCategoryAccepted(cat, false)}
                              className="rounded border px-2 py-1 hover:bg-muted"
                            >
                              Skip all
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                              <th className="px-3 py-2 font-medium">Accept</th>
                              <th className="px-3 py-2 font-medium">Item</th>
                              <th className="px-3 py-2 text-right font-medium">On hand</th>
                              <th className="px-3 py-2 text-right font-medium">Use 30d</th>
                              <th className="px-3 py-2 text-right font-medium">Use 90d</th>
                              <th className="px-3 py-2 text-right font-medium">Min</th>
                              <th className="px-3 py-2 text-right font-medium">Reorder pt</th>
                              <th className="px-3 py-2 text-right font-medium">Order qty</th>
                              <th className="px-3 py-2 font-medium">Why</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((p) => {
                              const e = edits[p.catalog_item_id];
                              const canAccept = p.enough_history;
                              return (
                                <tr
                                  key={p.catalog_item_id}
                                  className={`border-b last:border-0 ${
                                    e?.accepted ? 'bg-primary/5' : ''
                                  }`}
                                >
                                  <td className="px-3 py-2">
                                    {canAccept ? (
                                      <input
                                        type="checkbox"
                                        checked={!!e?.accepted}
                                        onChange={(ev) =>
                                          setEdit(p.catalog_item_id, { accepted: ev.target.checked })
                                        }
                                        className="h-4 w-4"
                                      />
                                    ) : (
                                      <span className="text-xs text-muted-foreground">—</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2">
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium">{p.name}</span>
                                      <span
                                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                                          CLASS_COLOR[p.classification]
                                        }`}
                                      >
                                        {CLASS_LABEL[p.classification]}
                                      </span>
                                    </div>
                                    <div className="font-mono text-xs text-muted-foreground">
                                      {p.sku}
                                      {p.uom_label ? ` · ${p.uom_label}` : ''}
                                      {p.current_reorder_point != null
                                        ? ` · was reorder ${p.current_reorder_point}`
                                        : ''}
                                    </div>
                                  </td>
                                  <td className="px-3 py-2 text-right font-mono">
                                    {p.qty_on_hand.toLocaleString()}
                                  </td>
                                  <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                                    {p.usage_30d.toLocaleString()}
                                  </td>
                                  <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                                    {p.usage_90d.toLocaleString()}
                                  </td>
                                  {canAccept ? (
                                    <>
                                      <td className="px-3 py-2 text-right">
                                        <input
                                          value={e?.min ?? ''}
                                          onChange={(ev) =>
                                            setEdit(p.catalog_item_id, { min: ev.target.value })
                                          }
                                          inputMode="numeric"
                                          className="w-16 rounded border bg-background px-2 py-1 text-right"
                                          placeholder="—"
                                        />
                                      </td>
                                      <td className="px-3 py-2 text-right">
                                        <input
                                          value={e?.rop ?? ''}
                                          onChange={(ev) =>
                                            setEdit(p.catalog_item_id, { rop: ev.target.value })
                                          }
                                          inputMode="numeric"
                                          className="w-16 rounded border bg-background px-2 py-1 text-right"
                                          placeholder="—"
                                        />
                                      </td>
                                      <td className="px-3 py-2 text-right">
                                        <input
                                          value={e?.qty ?? ''}
                                          onChange={(ev) =>
                                            setEdit(p.catalog_item_id, { qty: ev.target.value })
                                          }
                                          inputMode="numeric"
                                          className="w-16 rounded border bg-background px-2 py-1 text-right"
                                          placeholder="—"
                                        />
                                      </td>
                                    </>
                                  ) : (
                                    <td colSpan={3} className="px-3 py-2 text-center text-xs italic text-muted-foreground">
                                      not enough history
                                    </td>
                                  )}
                                  <td className="max-w-[16rem] px-3 py-2 text-xs text-muted-foreground">
                                    {p.rationale}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!loading && !result && proposals.length > 0 && (
          <div className="flex items-center justify-between gap-3 border-t px-5 py-3">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setAllAccepted(true)}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
              >
                Accept all proposed
              </button>
              <button
                onClick={() => setAllAccepted(false)}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
              >
                Clear
              </button>
              {error && <span className="text-sm text-red-600">{error}</span>}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">
                {acceptedCount} item{acceptedCount === 1 ? '' : 's'} selected
              </span>
              <button
                onClick={submit}
                disabled={saving || acceptedCount === 0}
                className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Applying…
                  </span>
                ) : (
                  `Accept ${acceptedCount || ''} & set levels`
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
