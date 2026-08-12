'use client';

import { useState, useEffect } from 'react';
import { authenticatedFetch } from '@/lib/api-client';
import { ActivityHeatmap } from './ActivityHeatmap';
import { HalfGauge } from './HalfGauge';

interface Insights {
  heatmap: { date: string; value: number }[];
  totals: {
    counts_completed_90d?: number;
    counts_completed_total?: number;
    lines_counted_90d?: number;
    lines_counted_365d?: number;
    accuracy_pct_90d?: number | null;
  };
  adherence: { done?: number; skipped?: number; overdue?: number; upcoming_30d?: number };
  locations: { id: string; name: string; last_counted_at: string | null }[];
  leaderboard: {
    user_id: string;
    name: string;
    lines_counted: number;
    accurate_lines: number;
    counts_completed: number;
    accuracy_pct: number | null;
    level: number;
    title: string;
    xp: number;
    xp_into_level: number;
    xp_for_next: number | null;
    progress: number;
  }[];
}

const RANK_MEDALS = ['🥇', '🥈', '🥉'];

function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
}

function initials(name: string): string {
  return name.split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

export function CountInsightsTab() {
  const [insights, setInsights] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authenticatedFetch('/api/inventory/count-insights')
      .then(res => res.json())
      .then(({ data }) => setInsights(data))
      .catch(err => console.error('Error fetching insights:', err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="text-sm text-muted-foreground py-12 text-center">Crunching the numbers…</div>;
  }
  if (!insights) {
    return <div className="text-sm text-muted-foreground py-12 text-center">Couldn't load insights.</div>;
  }

  const { totals, adherence, locations, leaderboard, heatmap } = insights;

  const adherenceTotal = (adherence.done || 0) + (adherence.skipped || 0) + (adherence.overdue || 0);
  const adherencePct = adherenceTotal > 0 ? (adherence.done || 0) / adherenceTotal : null;

  const countedRecently = locations.filter(l => {
    const d = daysSince(l.last_counted_at);
    return d !== null && d <= 90;
  }).length;
  const coveragePct = locations.length > 0 ? countedRecently / locations.length : null;

  const accuracy = totals.accuracy_pct_90d != null ? Number(totals.accuracy_pct_90d) / 100 : null;

  return (
    <div className="space-y-6">
      {/* Stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile value={totals.counts_completed_90d ?? 0} label="Counts Completed" sub="last 90 days" />
        <StatTile value={totals.lines_counted_90d ?? 0} label="Items Counted" sub="last 90 days" />
        <StatTile value={adherence.upcoming_30d ?? 0} label="Counts Scheduled" sub="next 30 days" />
        <StatTile
          value={adherence.overdue ?? 0}
          label="Overdue"
          sub="on the calendar"
          accent={(adherence.overdue ?? 0) > 0 ? 'text-red-600' : 'text-green-600'}
        />
      </div>

      {/* Gauges */}
      <div className="border rounded-lg bg-white p-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 justify-items-center">
          <HalfGauge
            value={accuracy ?? 0}
            display={accuracy != null ? `${Math.round(accuracy * 100)}%` : '—'}
            label="Count Accuracy"
            sublabel="exact matches, 90d"
            color={accuracy == null ? '#9ca3af' : accuracy >= 0.9 ? '#22c55e' : accuracy >= 0.7 ? '#f59e0b' : '#ef4444'}
          />
          <HalfGauge
            value={adherencePct ?? 0}
            display={adherencePct != null ? `${Math.round(adherencePct * 100)}%` : '—'}
            label="Schedule Adherence"
            sublabel={adherenceTotal > 0 ? `${adherence.done}/${adherenceTotal} on time` : 'no past entries yet'}
            color={adherencePct == null ? '#9ca3af' : adherencePct >= 0.8 ? '#22c55e' : adherencePct >= 0.5 ? '#f59e0b' : '#ef4444'}
          />
          <HalfGauge
            value={coveragePct ?? 0}
            display={coveragePct != null ? `${Math.round(coveragePct * 100)}%` : '—'}
            label="Location Coverage"
            sublabel={`${countedRecently}/${locations.length} counted in 90d`}
            color="#3b82f6"
          />
        </div>
      </div>

      {/* Heatmap */}
      <div className="border rounded-lg bg-white p-6">
        <h3 className="text-sm font-semibold mb-3">Counting Activity</h3>
        <ActivityHeatmap days={heatmap} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Leaderboard */}
        <div className="border rounded-lg bg-white p-6">
          <h3 className="text-sm font-semibold mb-4">Counter Leaderboard <span className="text-xs font-normal text-gray-400">last 365 days</span></h3>
          {leaderboard.length === 0 ? (
            <p className="text-sm text-muted-foreground">No counting activity yet — complete a count to get on the board.</p>
          ) : (
            <div className="space-y-4">
              {leaderboard.map((u, i) => (
                <div key={u.user_id} className="flex items-center gap-4 p-3 rounded-lg border bg-gradient-to-r from-gray-50 to-white">
                  <div className="text-xl w-7 text-center shrink-0">
                    {RANK_MEDALS[i] || <span className="text-sm text-gray-400">#{i + 1}</span>}
                  </div>
                  <div className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-semibold text-sm shrink-0">
                    {initials(u.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{u.name}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-medium whitespace-nowrap">
                        Lv {u.level} · {u.title}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {u.counts_completed} counts · {u.lines_counted} items
                      {u.accuracy_pct != null && <> · {u.accuracy_pct}% accurate</>}
                    </div>
                  </div>
                  <div className="shrink-0">
                    <HalfGauge
                      value={u.progress}
                      display={`${u.xp.toLocaleString()}`}
                      label=""
                      sublabel={u.xp_for_next != null ? `${u.xp_into_level}/${u.xp_for_next} XP` : 'MAX LEVEL'}
                      color="#8b5cf6"
                      size={92}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Location freshness */}
        <div className="border rounded-lg bg-white p-6">
          <h3 className="text-sm font-semibold mb-4">Location Freshness <span className="text-xs font-normal text-gray-400">time since last completed count</span></h3>
          {locations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No locations yet.</p>
          ) : (
            <div className="space-y-2">
              {locations.map(l => {
                const d = daysSince(l.last_counted_at);
                const dot = d === null ? 'bg-gray-300' : d <= 30 ? 'bg-green-500' : d <= 90 ? 'bg-amber-400' : 'bg-red-500';
                const text = d === null ? 'Never counted' : d === 0 ? 'Counted today' : `${d} day${d === 1 ? '' : 's'} ago`;
                return (
                  <div key={l.id} className="flex items-center gap-3 py-1.5 border-b last:border-0">
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dot}`} />
                    <span className="flex-1 text-sm truncate">{l.name}</span>
                    <span className={`text-xs ${d === null ? 'text-gray-400' : d > 90 ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                      {text}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatTile({ value, label, sub, accent }: {
  value: number;
  label: string;
  sub: string;
  accent?: string;
}) {
  return (
    <div className="border rounded-lg bg-white p-4">
      <div className={`text-2xl font-bold tabular-nums ${accent || 'text-gray-900'}`}>
        {value.toLocaleString()}
      </div>
      <div className="text-sm font-medium text-gray-600">{label}</div>
      <div className="text-xs text-gray-400">{sub}</div>
    </div>
  );
}
