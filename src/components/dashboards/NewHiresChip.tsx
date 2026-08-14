'use client';

/**
 * "New hires" attention chip (kits sprint item 04).
 *
 * The kit automation runs without anyone asking it to, so the dashboard says so
 * out loud: when a hire has been provisioned in the last two weeks — or worse,
 * when one is stuck — a one-line strip appears with a link into the queue.
 * Silent when there's nothing to report, so it never becomes wallpaper.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { UserPlus, AlertTriangle } from 'lucide-react';

const RECENT_DAYS = 14;

interface Row {
  status: string;
  created_at: string;
  person_name: string | null;
}

export function NewHiresChip() {
  const [recent, setRecent] = useState<Row[]>([]);
  const [needsAttention, setNeedsAttention] = useState<Row[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/inventory/onboarding?limit=100', { credentials: 'include' });
        if (!res.ok) return;
        const json = await res.json();
        const rows: Row[] = json?.data?.provisions ?? [];
        if (cancelled) return;
        const cutoff = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000;
        setRecent(rows.filter((r) => r.status === 'provisioned' && new Date(r.created_at).getTime() >= cutoff));
        setNeedsAttention(rows.filter((r) => r.status === 'error' || r.status === 'planned'));
      } catch {
        // Dashboard chip — a failure here is not worth a red box.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (recent.length === 0 && needsAttention.length === 0) return null;

  const stuck = needsAttention.length > 0;
  const names = (stuck ? needsAttention : recent)
    .slice(0, 3)
    .map((r) => r.person_name)
    .filter(Boolean)
    .join(', ');

  return (
    <Link
      href="/inventory/onboarding"
      className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm transition-colors ${
        stuck
          ? 'border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100'
          : 'border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
      }`}
    >
      {stuck ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <UserPlus className="h-4 w-4 shrink-0" />}
      <span>
        {stuck ? (
          <>
            <span className="font-semibold">
              {needsAttention.length} new hire{needsAttention.length === 1 ? '' : 's'}
            </span>{' '}
            {needsAttention.length === 1 ? 'needs' : 'need'} a look{names ? ` — ${names}` : ''}.
          </>
        ) : (
          <>
            <span className="font-semibold">
              {recent.length} new hire{recent.length === 1 ? '' : 's'}
            </span>{' '}
            kitted in the last {RECENT_DAYS} days{names ? ` — ${names}` : ''}.
          </>
        )}
      </span>
      <span className="ml-auto text-xs opacity-70">Open the queue →</span>
    </Link>
  );
}
