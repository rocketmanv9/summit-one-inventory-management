'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { TrendingUp, TrendingDown, Minus, Search } from 'lucide-react';

interface UsageRow {
  catalog_item_id: string;
  sku: string | null;
  name: string;
  tracking_mode: string;
  month: string; // YYYY-MM-DD (first of month)
  usage_qty: number | string;
  received_qty: number | string;
  net_delta: number | string;
  end_on_hand: number | string;
}

type Metric = 'usage' | 'received' | 'onhand';

const METRICS: { key: Metric; label: string; help: string }[] = [
  { key: 'usage', label: 'Usage', help: 'Units consumed / issued out the door' },
  { key: 'received', label: 'Received', help: 'Units received in' },
  { key: 'onhand', label: 'On hand', help: 'Stock on hand at month end' },
];

const MONTH_OPTIONS = [6, 13, 24];

// PostgREST returns numeric columns as strings — coerce before math.
const num = (v: number | string | null | undefined): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};

const fmt = (n: number): string =>
  n % 1 === 0 ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 1 });

const monthShort = (iso: string): string => {
  const [y, m] = iso.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString(undefined, { month: 'short' });
};
const monthLong = (iso: string): string => {
  const [y, m] = iso.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
};

interface ItemAgg {
  id: string;
  name: string;
  sku: string | null;
  byMonth: Map<string, { usage: number; received: number; onhand: number }>;
  totalUsage: number;
  avgUsage: number;
  peakMonth: string | null;
  peakUsage: number;
  trendPct: number | null; // last 3mo vs prior 3mo usage
}

export default function UsageTrendsPage() {
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [months, setMonths] = useState(13);
  const [metric, setMetric] = useState<Metric>('usage');
  const [search, setSearch] = useState('');

  const load = useCallback(async (m: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/inventory/usage-trends?months=${m}`);
      if (!res.ok) {
        setError('Failed to load usage trends');
        return;
      }
      const json = await res.json();
      setRows(json.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load usage trends');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(months);
  }, [load, months]);

  // Ordered, unique month axis.
  const monthAxis = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.month);
    return Array.from(set).sort();
  }, [rows]);

  // Monthly totals for the headline chart.
  const monthlyTotals = useMemo(() => {
    const map = new Map<string, { usage: number; received: number; onhand: number }>();
    for (const mo of monthAxis) map.set(mo, { usage: 0, received: 0, onhand: 0 });
    for (const r of rows) {
      const slot = map.get(r.month);
      if (!slot) continue;
      slot.usage += num(r.usage_qty);
      slot.received += num(r.received_qty);
      slot.onhand += num(r.end_on_hand);
    }
    return monthAxis.map((mo) => ({ month: mo, ...map.get(mo)! }));
  }, [rows, monthAxis]);

  // Per-item aggregation.
  const items = useMemo<ItemAgg[]>(() => {
    const byId = new Map<string, ItemAgg>();
    for (const r of rows) {
      let it = byId.get(r.catalog_item_id);
      if (!it) {
        it = {
          id: r.catalog_item_id,
          name: r.name,
          sku: r.sku,
          byMonth: new Map(),
          totalUsage: 0,
          avgUsage: 0,
          peakMonth: null,
          peakUsage: 0,
          trendPct: null,
        };
        byId.set(r.catalog_item_id, it);
      }
      const usage = num(r.usage_qty);
      it.byMonth.set(r.month, {
        usage,
        received: num(r.received_qty),
        onhand: num(r.end_on_hand),
      });
      it.totalUsage += usage;
      if (usage > it.peakUsage) {
        it.peakUsage = usage;
        it.peakMonth = r.month;
      }
    }
    const n = monthAxis.length || 1;
    for (const it of byId.values()) {
      it.avgUsage = it.totalUsage / n;
      // Trend: sum of last 3 months vs the 3 before that.
      if (monthAxis.length >= 6) {
        const recent = monthAxis.slice(-3).reduce((s, mo) => s + (it.byMonth.get(mo)?.usage || 0), 0);
        const prior = monthAxis.slice(-6, -3).reduce((s, mo) => s + (it.byMonth.get(mo)?.usage || 0), 0);
        it.trendPct = prior > 0 ? ((recent - prior) / prior) * 100 : recent > 0 ? 100 : 0;
      }
    }
    return Array.from(byId.values());
  }, [rows, monthAxis]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? items.filter((i) => i.name.toLowerCase().includes(q) || (i.sku || '').toLowerCase().includes(q))
      : items;
    return [...list].sort((a, b) => b.totalUsage - a.totalUsage);
  }, [items, search]);

  // Busiest usage month across the whole catalog — the headline seasonal insight.
  const busiest = useMemo(() => {
    let best: { month: string; usage: number } | null = null;
    for (const m of monthlyTotals) {
      if (!best || m.usage > best.usage) best = { month: m.month, usage: m.usage };
    }
    return best && best.usage > 0 ? best : null;
  }, [monthlyTotals]);

  const chartMax = useMemo(() => {
    const vals = monthlyTotals.map((m) => m[metric]);
    return Math.max(1, ...vals);
  }, [monthlyTotals, metric]);

  const periodUsage = useMemo(
    () => monthlyTotals.reduce((s, m) => s + m.usage, 0),
    [monthlyTotals]
  );

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <PageHeader
          title="Usage Trends"
          description="Material storage & consumption over time — spot the seasons you burn through supplies so you can stock ahead."
          actions={
            <div className="flex gap-1 rounded-lg border border-border p-1">
              {MONTH_OPTIONS.map((m) => (
                <button
                  key={m}
                  onClick={() => setMonths(m)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    months === m
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {m} mo
                </button>
              ))}
            </div>
          }
        />

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {loading ? (
          <div className="py-24 text-center text-muted-foreground">Loading usage history…</div>
        ) : (
          <>
            {/* Seasonal insight banner */}
            {busiest ? (
              <div className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-4">
                <div className="text-sm font-semibold text-amber-900">
                  Peak usage month: {monthLong(busiest.month)}
                </div>
                <div className="mt-0.5 text-sm text-amber-800">
                  {fmt(busiest.usage)} units consumed that month — your heaviest draw in the last{' '}
                  {monthAxis.length} months. Plan reorders ahead of this window.
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-muted/40 px-5 py-4 text-sm text-muted-foreground">
                No consumption recorded yet in this window. Once items are issued or consumed,
                seasonal trends will appear here.
              </div>
            )}

            {/* Headline monthly chart */}
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Monthly {METRICS.find((m) => m.key === metric)!.label}</h2>
                  <p className="text-sm text-muted-foreground">
                    {METRICS.find((m) => m.key === metric)!.help}
                    {metric === 'usage' && periodUsage > 0 && ` · ${fmt(periodUsage)} total this period`}
                  </p>
                </div>
                <div className="flex gap-1 rounded-lg border border-border p-1">
                  {METRICS.map((m) => (
                    <button
                      key={m.key}
                      onClick={() => setMetric(m.key)}
                      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                        metric === m.key
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-end gap-2" style={{ height: 200 }}>
                {monthlyTotals.map((m) => {
                  const v = m[metric];
                  const pct = (v / chartMax) * 100;
                  const isPeak = busiest && metric === 'usage' && m.month === busiest.month;
                  return (
                    <div key={m.month} className="flex flex-1 flex-col items-center justify-end gap-1">
                      <span className="text-[10px] text-muted-foreground">{v > 0 ? fmt(v) : ''}</span>
                      <div
                        className={`w-full rounded-t transition-all ${
                          isPeak ? 'bg-amber-500' : 'bg-primary/80'
                        }`}
                        style={{ height: `${Math.max(pct, v > 0 ? 3 : 0)}%`, minHeight: v > 0 ? 4 : 0 }}
                        title={`${monthLong(m.month)}: ${fmt(v)}`}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 flex gap-2">
                {monthlyTotals.map((m) => (
                  <div key={m.month} className="flex-1 text-center text-[11px] text-muted-foreground">
                    {monthShort(m.month)}
                  </div>
                ))}
              </div>
            </div>

            {/* Per-item table */}
            <div className="rounded-xl border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border p-4">
                <h2 className="text-lg font-semibold">By item</h2>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search items…"
                    className="w-56 rounded-lg border border-border bg-background py-2 pl-8 pr-3 text-sm"
                  />
                </div>
              </div>

              {filteredItems.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">No items match.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-2 font-medium">Item</th>
                        <th className="px-4 py-2 text-right font-medium">Total used</th>
                        <th className="px-4 py-2 text-right font-medium">Avg / mo</th>
                        <th className="px-4 py-2 font-medium">Peak month</th>
                        <th className="px-4 py-2 text-right font-medium">3-mo trend</th>
                        <th className="px-4 py-2 font-medium">Usage by month</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredItems.map((it) => {
                        const sparkMax = Math.max(1, ...monthAxis.map((mo) => it.byMonth.get(mo)?.usage || 0));
                        return (
                          <tr key={it.id} className="border-b border-border/60 last:border-0">
                            <td className="px-4 py-3">
                              <div className="font-medium">{it.name}</div>
                              {it.sku && <div className="text-xs text-muted-foreground">{it.sku}</div>}
                            </td>
                            <td className="px-4 py-3 text-right font-medium tabular-nums">
                              {fmt(it.totalUsage)}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                              {fmt(it.avgUsage)}
                            </td>
                            <td className="px-4 py-3">
                              {it.peakMonth && it.peakUsage > 0 ? (
                                <span className="text-xs">
                                  {monthLong(it.peakMonth)}{' '}
                                  <span className="text-muted-foreground">({fmt(it.peakUsage)})</span>
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              {it.trendPct === null ? (
                                <span className="text-xs text-muted-foreground">—</span>
                              ) : (
                                <span
                                  className={`inline-flex items-center gap-1 text-xs font-medium ${
                                    it.trendPct > 5
                                      ? 'text-red-600'
                                      : it.trendPct < -5
                                      ? 'text-green-600'
                                      : 'text-muted-foreground'
                                  }`}
                                >
                                  {it.trendPct > 5 ? (
                                    <TrendingUp className="h-3.5 w-3.5" />
                                  ) : it.trendPct < -5 ? (
                                    <TrendingDown className="h-3.5 w-3.5" />
                                  ) : (
                                    <Minus className="h-3.5 w-3.5" />
                                  )}
                                  {it.trendPct > 0 ? '+' : ''}
                                  {Math.round(it.trendPct)}%
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-end gap-0.5" style={{ height: 28 }}>
                                {monthAxis.map((mo) => {
                                  const u = it.byMonth.get(mo)?.usage || 0;
                                  const h = (u / sparkMax) * 100;
                                  return (
                                    <div
                                      key={mo}
                                      className="w-1.5 rounded-t bg-primary/70"
                                      style={{ height: `${u > 0 ? Math.max(h, 8) : 0}%` }}
                                      title={`${monthShort(mo)}: ${fmt(u)}`}
                                    />
                                  );
                                })}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
