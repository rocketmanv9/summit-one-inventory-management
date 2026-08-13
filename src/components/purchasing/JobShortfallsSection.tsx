'use client';

/**
 * Job shortfalls — the purchasing inbox's "close the supply loop" section
 * (V1-C, sprint 2026-08-12 #23). Lists items where active job reservations
 * exceed supply (available + on order), grouped by preferred vendor + yard,
 * with a one-tap "Draft PO" per group. The server re-derives quantities and
 * routes the draft through the normal PO approval machinery; a drafted PO
 * counts as on-order, so its group clears from this list on the next load.
 * Renders nothing when there is no shortfall.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, PackageX } from 'lucide-react';

interface ShortageJobRef {
  job_id: string | null;
  job_name: string | null;
  qty: number;
}

interface ShortageLine {
  catalog_item_id: string;
  sku: string | null;
  item_name: string;
  location_id: string;
  location_name: string;
  job_demand: number;
  demand_total: number;
  qty_on_hand: number;
  qty_on_order: number;
  shortfall: number;
  earliest_needed_by: string | null;
  jobs: ShortageJobRef[];
  suggested_order_qty: number;
  estimated_unit_cost: number | null;
}

interface ShortageGroup {
  vendor_id: string | null;
  vendor_name: string | null;
  location_id: string;
  location_name: string;
  lines: ShortageLine[];
}

export function JobShortfallsSection({ onDrafted }: { onDrafted?: () => void }) {
  const [groups, setGroups] = useState<ShortageGroup[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Which group's Draft PO is in flight (vendor::location key), and per-group results.
  const [draftingKey, setDraftingKey] = useState<string | null>(null);
  const [drafted, setDrafted] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const groupKey = (g: ShortageGroup) => `${g.vendor_id ?? 'none'}::${g.location_id}`;

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/inventory/purchasing/from-shortage', { credentials: 'include' });
      if (!res.ok) return;
      const { data } = await res.json();
      setGroups((data?.groups ?? []) as ShortageGroup[]);
    } catch {
      /* section degrades to hidden */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function draftPo(group: ShortageGroup) {
    const key = groupKey(group);
    setDraftingKey(key);
    setError(null);
    try {
      const res = await fetch('/api/inventory/purchasing/from-shortage', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          lines: group.lines.map((l) => ({
            catalog_item_id: l.catalog_item_id,
            location_id: l.location_id,
          })),
        }),
      });
      if (!res.ok) {
        setError(`Couldn't draft the PO (${res.status}).`);
        return;
      }
      const { data } = await res.json();
      const pos = (data?.purchase_orders ?? []) as Array<{ po_number: string | null; status: string | null }>;
      if (pos.length > 0) {
        setDrafted((prev) => ({
          ...prev,
          [key]: pos
            .map((p) => `${p.po_number ?? 'PO'}${p.status === 'awaiting_approval' ? ' (awaiting approval)' : p.status === 'draft' ? ' (draft — needs pricing)' : ''}`)
            .join(', '),
        }));
      } else {
        setDrafted((prev) => ({ ...prev, [key]: 'already covered' }));
      }
      onDrafted?.();
      await load();
    } catch {
      setError("Couldn't draft the PO — try again.");
    } finally {
      setDraftingKey(null);
    }
  }

  // Nothing short (or not loaded yet) and nothing just drafted → stay out of the way.
  if (!loaded || (groups.length === 0 && Object.keys(drafted).length === 0)) return null;

  return (
    <div className="rounded-lg border border-red-200 bg-red-50/50 p-4">
      <div className="mb-1 flex items-center gap-2">
        <PackageX className="h-4 w-4 text-red-600" />
        <h3 className="text-sm font-semibold text-red-900">Job shortfalls</h3>
        <span className="text-xs text-red-700">
          jobs have reserved more than you have (on hand + on order)
        </span>
      </div>

      {error && <p className="mb-2 text-xs font-medium text-red-700">{error}</p>}

      {/* Groups that were just drafted this session but have cleared from the list. */}
      {Object.entries(drafted)
        .filter(([key]) => !groups.some((g) => groupKey(g) === key))
        .map(([key, label]) => (
          <p key={key} className="mb-1 text-xs font-medium text-emerald-700">
            ✓ Drafted {label} — it now counts as on-order.
          </p>
        ))}

      <div className="space-y-2">
        {groups.map((group) => {
          const key = groupKey(group);
          return (
            <div key={key} className="rounded-lg border border-red-200 bg-white p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">
                  {group.vendor_name ?? 'No vendor on file'}
                </span>
                <span className="text-xs text-muted-foreground">→ {group.location_name}</span>
                {!group.vendor_id && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800"
                    title="No preferred vendor on the item or yard — the draft goes to a placeholder vendor; assign a real one before approving."
                  >
                    <AlertTriangle className="h-3 w-3" /> assign vendor after drafting
                  </span>
                )}
                <button
                  onClick={() => void draftPo(group)}
                  disabled={draftingKey !== null}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                >
                  {draftingKey === key && <Loader2 className="h-3 w-3 animate-spin" />}
                  Draft PO for the shortfall
                </button>
              </div>
              <ul className="space-y-1">
                {group.lines.map((l) => (
                  <li
                    key={`${l.catalog_item_id}:${l.location_id}`}
                    className="flex flex-wrap items-baseline gap-x-2 text-xs"
                  >
                    <span className="font-medium">{l.item_name}</span>
                    {l.sku && <span className="font-mono text-muted-foreground">{l.sku}</span>}
                    <span className="font-semibold text-red-700">short {l.shortfall}</span>
                    <span className="text-muted-foreground">
                      (reserved {l.demand_total} · on hand {l.qty_on_hand} · on order {l.qty_on_order})
                      {' '}→ order {l.suggested_order_qty}
                    </span>
                    <span className="text-muted-foreground">
                      for {l.jobs.map((j) => j.job_name || j.job_id).filter(Boolean).join(', ')}
                    </span>
                    {l.earliest_needed_by && (
                      <span className="text-amber-700">
                        needed by {new Date(l.earliest_needed_by).toLocaleDateString()}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
