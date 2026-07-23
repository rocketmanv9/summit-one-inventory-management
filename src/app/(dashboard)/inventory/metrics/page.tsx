'use client';

/**
 * Item Metrics — pick a handful of items and graph their history.
 *
 * Deliberately focused: YOU choose which items to display (nothing is shown by
 * default) and one graph renders at a time (stock on hand / daily activity /
 * spend). Data comes from /api/inventory/metrics, which reads the nightly
 * daily_item_activity rollup.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { HowItWorksCard, HowThisWorksButton, useHowItWorks } from '@/components/ui/HowItWorksCard';
import { ChevronDown, LineChart as LineChartIcon, BarChart3, DollarSign, X, Boxes, Activity, TrendingUp } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, Legend, CartesianGrid, ReferenceLine,
} from 'recharts';

interface CatalogItem {
  id: string;
  name: string;
  sku: string;
}

interface DayPoint {
  date: string;
  received: number;
  issued: number;
  net: number;
  spend: number;
  on_hand: number;
}

interface ItemMetrics {
  id: string;
  name: string;
  sku: string;
  reorder_point: number | null;
  current_on_hand: number;
  usage_30d: number;
  days_of_stock: number | null;
  total_received: number;
  total_issued: number;
  total_spend: number;
  series: DayPoint[];
}

const COLORS = ['#2563eb', '#16a34a', '#ea580c', '#9333ea', '#dc2626', '#0891b2', '#ca8a04', '#db2777'];
const RANGES = [30, 90, 180, 365] as const;
const MAX_ITEMS = 8;

type ChartKind = 'on_hand' | 'activity' | 'spend';

const CHARTS: { key: ChartKind; title: string; icon: typeof LineChartIcon; blurb: string }[] = [
  { key: 'on_hand', title: 'Stock on hand', icon: LineChartIcon, blurb: 'Quantity on hand over time, one line per item.' },
  { key: 'activity', title: 'Daily activity', icon: BarChart3, blurb: 'Received vs. used per day across the selected items.' },
  { key: 'spend', title: 'Spend', icon: DollarSign, blurb: 'Purchasing dollars per day across the selected items.' },
];

export default function ItemMetricsPage() {
  const help = useHowItWorks('inventory-metrics-help');
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [days, setDays] = useState<(typeof RANGES)[number]>(90);
  const [chart, setChart] = useState<ChartKind>('on_hand');
  const [metrics, setMetrics] = useState<ItemMetrics[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const pickerRef = useRef<HTMLDivElement>(null);

  // Restore selection from the URL so metric views are shareable/bookmarkable.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const items = (p.get('items') || '').split(',').filter(Boolean);
    const d = Number(p.get('days'));
    const c = p.get('chart');
    if (items.length) setSelected(items.slice(0, MAX_ITEMS));
    if (RANGES.includes(d as any)) setDays(d as any);
    if (c === 'on_hand' || c === 'activity' || c === 'spend') setChart(c);
  }, []);

  useEffect(() => {
    const p = new URLSearchParams();
    if (selected.length) p.set('items', selected.join(','));
    p.set('days', String(days));
    p.set('chart', chart);
    window.history.replaceState(null, '', `${window.location.pathname}?${p}`);
  }, [selected, days, chart]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/inventory/items');
        const { data } = await res.json();
        setCatalog((data || []).map((i: any) => ({ id: i.id, name: i.name, sku: i.sku })));
      } catch (err) {
        console.error('Error loading items:', err);
      }
    })();
  }, []);

  const fetchMetrics = useCallback(async () => {
    if (selected.length === 0) { setMetrics([]); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/inventory/metrics?items=${selected.join(',')}&days=${days}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error?.message || body.error || 'Failed to load metrics');
        setMetrics([]);
        return;
      }
      const { data } = await res.json();
      setMetrics(data.items || []);
    } catch {
      setError('Failed to load metrics. Try again.');
    } finally {
      setLoading(false);
    }
  }, [selected, days]);

  useEffect(() => { fetchMetrics(); }, [fetchMetrics]);

  // Close the picker on outside click.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const toggleItem = (id: string) => {
    setSelected((prev) => prev.includes(id)
      ? prev.filter((x) => x !== id)
      : prev.length >= MAX_ITEMS ? prev : [...prev, id]);
  };

  const filteredCatalog = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter((i) => i.name.toLowerCase().includes(q) || (i.sku || '').toLowerCase().includes(q));
  }, [catalog, search]);

  // Merge per-item series into one row per date for recharts.
  const mergedRows = useMemo(() => {
    if (metrics.length === 0) return [];
    const base = metrics[0].series;
    return base.map((_, idx) => {
      const row: Record<string, number | string> = { date: base[idx].date };
      let received = 0, issued = 0, spend = 0;
      for (const m of metrics) {
        const p = m.series[idx];
        if (!p) continue;
        row[`on_hand_${m.id}`] = p.on_hand;
        received += p.received;
        issued += p.issued;
        spend += p.spend;
      }
      row.received = received;
      row.issued = issued;
      row.spend = Math.round(spend * 100) / 100;
      return row;
    });
  }, [metrics]);

  const fmtDate = (d: string) => {
    const dt = new Date(d + 'T00:00:00');
    return `${dt.getMonth() + 1}/${dt.getDate()}`;
  };

  const activeChart = CHARTS.find((c) => c.key === chart)!;

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Item Metrics"
          description="Pick the items you care about and graph their history."
          actions={!help.show ? <HowThisWorksButton onClick={help.open} /> : undefined}
        />

        {help.show && (
          <HowItWorksCard
            title="How item metrics work"
            onDismiss={help.dismiss}
            steps={[
              { title: 'Pick your items', body: 'Nothing is graphed by default — choose up to 8 items you actually care about watching. Your picks stay in the page URL, so bookmark it or share it.' },
              { title: 'Pick a window', body: '30, 90, 180, or 365 days of history. History comes from a nightly rollup of every stock movement.' },
              { title: 'Pick one graph', body: 'Stock on hand, daily activity (received vs. used), or purchasing spend — one chart at a time, so it stays readable.' },
              { title: 'Act on it', body: 'Watch a single item to see its reorder point drawn on the chart. Low days-of-stock shows red on the summary cards.' },
            ]}
            glossary={[
              { Icon: Boxes, term: 'Stock on hand', blurb: 'quantity in stock at the end of each day, reconstructed from movement history' },
              { Icon: Activity, term: 'Daily activity', blurb: 'received vs. used quantities per day, summed across your selected items' },
              { Icon: TrendingUp, term: 'Spend', blurb: 'purchasing dollars per day (received quantity × unit cost)' },
            ]}
          />
        )}

        {/* Controls: item picker + range + chart type */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative" ref={pickerRef}>
            <button
              onClick={() => setPickerOpen((o) => !o)}
              className="flex items-center gap-2 rounded-lg border bg-card px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              {selected.length === 0 ? 'Choose items…' : `${selected.length} item${selected.length > 1 ? 's' : ''} selected`}
              <ChevronDown className="h-4 w-4" />
            </button>
            {pickerOpen && (
              <div className="absolute z-30 mt-2 w-96 rounded-lg border bg-card shadow-lg">
                <div className="border-b p-2">
                  <input
                    autoFocus
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search items…"
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div className="max-h-80 overflow-y-auto p-1">
                  {filteredCatalog.length === 0 && (
                    <p className="px-3 py-4 text-sm text-muted-foreground">No items match.</p>
                  )}
                  {filteredCatalog.map((item) => {
                    const checked = selected.includes(item.id);
                    const disabled = !checked && selected.length >= MAX_ITEMS;
                    return (
                      <label
                        key={item.id}
                        className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-accent ${disabled ? 'opacity-40' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggleItem(item.id)}
                          className="h-4 w-4"
                        />
                        <span className="flex-1">
                          <span className="font-medium">{item.name}</span>
                          <span className="ml-2 font-mono text-xs text-muted-foreground">{item.sku}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <div className="border-t px-3 py-2 text-xs text-muted-foreground">
                  Up to {MAX_ITEMS} items at once.
                </div>
              </div>
            )}
          </div>

          <div className="flex rounded-lg border bg-card p-1">
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setDays(r)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${days === r ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {r}d
              </button>
            ))}
          </div>

          <div className="flex rounded-lg border bg-card p-1">
            {CHARTS.map((c) => {
              const Icon = c.icon;
              return (
                <button
                  key={c.key}
                  onClick={() => setChart(c.key)}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${chart === c.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <Icon className="h-4 w-4" />
                  {c.title}
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected item chips w/ legend colors */}
        {selected.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {selected.map((id, idx) => {
              const item = catalog.find((c) => c.id === id);
              return (
                <span
                  key={id}
                  className="flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-sm"
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                  {item?.name ?? id}
                  <button onClick={() => toggleItem(id)} className="text-muted-foreground hover:text-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              );
            })}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {selected.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-card px-6 py-16 text-center">
            <BarChart3 className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <p className="font-medium">Nothing to graph yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose one or more items above — only the items you pick are tracked here.
            </p>
          </div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {metrics.map((m, idx) => (
                <div key={m.id} className="rounded-lg border bg-card p-4">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                    <p className="truncate text-sm font-medium">{m.name}</p>
                  </div>
                  <p className="mt-2 text-2xl font-bold">{m.current_on_hand.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">on hand now</p>
                  <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                    <p>Used last 30d: <span className="font-medium text-foreground">{m.usage_30d.toLocaleString()}</span></p>
                    {m.days_of_stock != null && (
                      <p>Days of stock: <span className={`font-medium ${m.days_of_stock <= 7 ? 'text-destructive' : 'text-foreground'}`}>{m.days_of_stock}</span></p>
                    )}
                    <p>Spend ({days}d): <span className="font-medium text-foreground">${m.total_spend.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></p>
                  </div>
                </div>
              ))}
            </div>

            {/* The one active chart */}
            <div className="rounded-lg border bg-card p-4">
              <div className="mb-4">
                <h2 className="font-semibold">{activeChart.title}</h2>
                <p className="text-sm text-muted-foreground">{activeChart.blurb}</p>
              </div>
              {loading ? (
                <div className="flex h-80 items-center justify-center text-sm text-muted-foreground">Loading…</div>
              ) : (
                <div className="h-80 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    {chart === 'on_hand' ? (
                      <LineChart data={mergedRows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" className="opacity-40" />
                        <XAxis dataKey="date" tickFormatter={fmtDate} minTickGap={32} fontSize={12} />
                        <YAxis fontSize={12} allowDecimals={false} width={48} />
                        <Tooltip labelFormatter={(d) => String(d)} />
                        <Legend />
                        {metrics.map((m, idx) => (
                          <Line
                            key={m.id}
                            type="stepAfter"
                            dataKey={`on_hand_${m.id}`}
                            name={m.name}
                            stroke={COLORS[idx % COLORS.length]}
                            strokeWidth={2}
                            dot={false}
                          />
                        ))}
                        {metrics.length === 1 && metrics[0].reorder_point != null && (
                          <ReferenceLine
                            y={metrics[0].reorder_point}
                            stroke="#dc2626"
                            strokeDasharray="6 3"
                            label={{ value: 'Reorder point', fontSize: 11, fill: '#dc2626', position: 'insideTopRight' }}
                          />
                        )}
                      </LineChart>
                    ) : chart === 'activity' ? (
                      <BarChart data={mergedRows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" className="opacity-40" />
                        <XAxis dataKey="date" tickFormatter={fmtDate} minTickGap={32} fontSize={12} />
                        <YAxis fontSize={12} width={48} />
                        <Tooltip labelFormatter={(d) => String(d)} />
                        <Legend />
                        <Bar dataKey="received" name="Received" fill="#16a34a" radius={[2, 2, 0, 0]} />
                        <Bar dataKey="issued" name="Used" fill="#ea580c" radius={[2, 2, 0, 0]} />
                      </BarChart>
                    ) : (
                      <BarChart data={mergedRows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" className="opacity-40" />
                        <XAxis dataKey="date" tickFormatter={fmtDate} minTickGap={32} fontSize={12} />
                        <YAxis fontSize={12} width={56} tickFormatter={(v) => `$${v}`} />
                        <Tooltip labelFormatter={(d) => String(d)} formatter={(v: any) => [`$${Number(v).toLocaleString()}`, 'Spend']} />
                        <Bar dataKey="spend" name="Spend" fill="#2563eb" radius={[2, 2, 0, 0]} />
                      </BarChart>
                    )}
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
