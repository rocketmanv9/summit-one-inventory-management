'use client';

/**
 * "My Spending & Limits" card — the signed-in user's own per-PO cap and, if set,
 * their recurring budget usage for the current period. Self-contained (fetches
 * /api/hr/my-spend), so it can be dropped on a dashboard, the purchasing page,
 * or a settings tab. Pass `compact` for a tighter widget layout.
 */
import { useState, useEffect } from 'react';
import { Wallet, Gauge } from 'lucide-react';

interface Budget {
  amount: number | null;
  period: string;
  spent: number;
  remaining: number | null;
  period_start: string;
  period_end: string;
}
interface MySpend {
  name: string | null;
  position_title: string | null;
  per_po_limit: number | null;
  per_po_limit_source: 'you' | 'position' | 'company' | null;
  budget: Budget | null;
}

const usd = (n: number | null | undefined) =>
  n === null || n === undefined
    ? '—'
    : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const PERIOD_LABEL: Record<string, string> = {
  weekly: 'this week',
  monthly: 'this month',
  quarterly: 'this quarter',
  annual: 'this year',
};

const SOURCE_LABEL: Record<string, string> = {
  you: 'your limit',
  position: 'from your position',
  company: 'company default',
};

export function MySpendCard({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<MySpend | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/hr/my-spend');
        const json = await res.json();
        if (!alive) return;
        if (res.ok) setData(json.data);
        else setError(json?.error?.message || 'Could not load your spending.');
      } catch {
        if (alive) setError('Could not load your spending.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (loading) return <div className="rounded-lg border bg-card p-5 animate-pulse h-36" />;
  if (error) return <div className="rounded-lg border bg-card p-5 text-sm text-red-600">{error}</div>;
  if (!data) return null;

  const b = data.budget;
  const pct =
    b && b.amount && b.amount > 0 ? Math.min(100, Math.round((b.spent / b.amount) * 100)) : 0;
  const over = b?.remaining != null && b.remaining < 0;
  const barColor = over ? 'bg-red-500' : pct >= 85 ? 'bg-amber-500' : 'bg-green-500';

  return (
    <div className="rounded-lg border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Wallet className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">My Spending &amp; Limits</h3>
      </div>

      {/* Recurring budget */}
      {b && b.amount != null ? (
        <div>
          <div className="flex items-end justify-between mb-1">
            <span className="text-2xl font-semibold">{usd(b.remaining)}</span>
            <span className="text-xs text-muted-foreground">
              left of {usd(b.amount)} {PERIOD_LABEL[b.period] ?? b.period}
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
            <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="flex items-center justify-between mt-1 text-xs text-muted-foreground">
            <span>{usd(b.spent)} spent {over ? '· over budget' : ''}</span>
            <span>resets {b.period_end}</span>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No recurring budget set — you have no periodic spending cap.
        </p>
      )}

      {/* Per-PO approval cap */}
      {!compact && (
        <div className="flex items-center gap-2 border-t pt-3 text-sm">
          <Gauge className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Per-order approval limit:</span>
          <span className="font-medium">{usd(data.per_po_limit)}</span>
          {data.per_po_limit_source && (
            <span className="text-xs text-muted-foreground">
              ({SOURCE_LABEL[data.per_po_limit_source]})
            </span>
          )}
        </div>
      )}
    </div>
  );
}
