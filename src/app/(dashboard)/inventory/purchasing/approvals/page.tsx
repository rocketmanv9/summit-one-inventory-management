'use client';

/**
 * The manager's approval inbox + decision history (rework P2, Grant 2026-08-04;
 * history added 2026-08-05).
 *
 * Pending tab: every PO awaiting sign-off THIS user can act on — routed to them
 * as the buyer's HR supervisor / location approver, or all of them for admins.
 * One tap to approve; reject requires a reason the buyer sees. Unchanged.
 *
 * Approved / Denied tabs: what got decided and when, scoped the same way
 * (non-admins see their own decisions, admins see everyone's). Filterable by
 * decision date and paginated server-side. Phone-friendly on purpose.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Inbox, Loader2, ShoppingCart, XCircle } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';

interface InboxItem {
  id: string;
  po_number: string;
  vendor_name: string | null;
  is_amazon: boolean;
  buyer_name: string;
  delivery_location: string | null;
  reason: string | null;
  total: number;
  created_at: string;
  can_decide: boolean;
  decided_by: string | null;
  decided_at: string | null;
  rejection_reason: string | null;
}

type Tab = 'pending' | 'approved' | 'denied';
type RangeKey = 'all' | '7d' | '30d' | '90d' | 'custom';

const PAGE_SIZE = 25;

const TABS: { key: Tab; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'denied', label: 'Denied' },
];

const QUICK_RANGES: { key: RangeKey; label: string; days: number | null }[] = [
  { key: 'all', label: 'All time', days: null },
  { key: '7d', label: '7 days', days: 7 },
  { key: '30d', label: '30 days', days: 30 },
  { key: '90d', label: '90 days', days: 90 },
];

export default function ApprovalsInboxPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('pending');
  const [items, setItems] = useState<InboxItem[]>([]);
  const [counts, setCounts] = useState<Record<Tab, number>>({ pending: 0, approved: 0, denied: 0 });
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<InboxItem | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [error, setError] = useState('');

  // Date filter (history tabs only).
  const [range, setRange] = useState<RangeKey>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  // The from/to the server sees, derived from the range picker.
  const dateParams = useCallback((): { from?: string; to?: string } => {
    if (tab === 'pending' || range === 'all') return {};
    if (range === 'custom') {
      const out: { from?: string; to?: string } = {};
      if (customFrom) out.from = customFrom;
      // Include the whole 'to' day.
      if (customTo) out.to = `${customTo}T23:59:59.999Z`;
      return out;
    }
    const days = QUICK_RANGES.find((r) => r.key === range)?.days;
    if (!days) return {};
    return { from: new Date(Date.now() - days * 86_400_000).toISOString() };
  }, [tab, range, customFrom, customTo]);

  const loadCounts = useCallback(async () => {
    const qs = new URLSearchParams({ counts: '1' });
    const { from, to } = dateParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    const res = await fetch(`/api/inventory/purchasing/approvals?${qs}`, { credentials: 'include' });
    if (!res.ok) return;
    const { data } = await res.json();
    if (data?.counts) setCounts(data.counts);
    setIsAdmin(!!data?.is_admin);
  }, [dateParams]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ status: tab, limit: String(PAGE_SIZE), offset: String(offset) });
      const { from, to } = dateParams();
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      const res = await fetch(`/api/inventory/purchasing/approvals?${qs}`, { credentials: 'include' });
      if (!res.ok) return;
      const { data } = await res.json();
      setItems(data.items || []);
      setTotal(data.count ?? 0);
      setIsAdmin(!!data.is_admin);
    } finally {
      setLoading(false);
    }
  }, [tab, offset, dateParams]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadCounts(); }, [loadCounts]);
  // Reset paging when the tab or filter changes.
  useEffect(() => { setOffset(0); }, [tab, range, customFrom, customTo]);

  const decide = async (item: InboxItem, action: 'approve' | 'reject', reason?: string) => {
    setBusyId(item.id);
    setError('');
    try {
      const res = await fetch(`/api/inventory/purchasing/approvals/${item.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        credentials: 'include',
        body: JSON.stringify({ action, reason }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error?.message || `Couldn't ${action} (${res.status}).`);
        return;
      }
      setRejecting(null);
      setRejectReason('');
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      // A decision moves a PO between tabs — refresh the label counts.
      void loadCounts();
    } finally {
      setBusyId(null);
    }
  };

  const age = (iso: string) => {
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
    return days === 0 ? 'today' : days === 1 ? '1 day' : `${days} days`;
  };

  const decidedOn = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  const isHistory = tab !== 'pending';
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageNum = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl space-y-5 p-2 sm:p-0">
        <PageHeader
          backHref="/inventory/purchasing"
          title="Approvals"
          description={
            isAdmin
              ? 'Purchase-order sign-offs — pending, approved, and denied across the team.'
              : 'Purchase orders that need your sign-off, plus what you’ve decided.'
          }
        />

        {/* Tabs */}
        <div className="flex gap-1 rounded-lg border bg-muted/40 p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === t.key ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
              <span className={`ml-1.5 tabular-nums ${tab === t.key ? 'text-muted-foreground' : 'text-muted-foreground/70'}`}>
                ({counts[t.key]})
              </span>
            </button>
          ))}
        </div>

        {/* Date filter — history tabs only */}
        {isHistory && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {QUICK_RANGES.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setRange(r.key)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    range === r.key ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {r.label}
                </button>
              ))}
              <button
                onClick={() => setRange('custom')}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  range === 'custom' ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                Custom
              </button>
            </div>
            {range === 'custom' && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <label className="flex items-center gap-1.5">
                  From
                  <input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="rounded-md border px-2 py-1 text-xs"
                  />
                </label>
                <label className="flex items-center gap-1.5">
                  To
                  <input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="rounded-md border px-2 py-1 text-xs"
                  />
                </label>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 py-10 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-dashed p-12 text-center">
            <Inbox className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {tab === 'pending'
                ? 'Inbox zero — nothing needs your approval.'
                : tab === 'approved'
                ? 'No approvals in this window.'
                : 'No denials in this window.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <div key={item.id} className="rounded-xl border bg-background p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {item.buyer_name}
                      <span className="font-normal text-muted-foreground"> wants </span>
                      <span className="tabular-nums">${item.total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                      <span className="font-normal text-muted-foreground"> from </span>
                      {item.vendor_name || 'a vendor'}
                      {item.is_amazon && (
                        <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-px text-[10px] font-medium text-amber-800">Amazon</span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      <span className="font-mono">{item.po_number}</span>
                      {item.delivery_location && ` · to ${item.delivery_location}`}
                      {tab === 'pending' && ` · waiting ${age(item.created_at)}`}
                    </p>

                    {/* Pending: the reason it needs sign-off */}
                    {tab === 'pending' && item.reason && (
                      <p className="mt-1.5 inline-block rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800">
                        {item.reason}
                      </p>
                    )}

                    {/* History: who decided + when */}
                    {isHistory && item.decided_at && (
                      <p className="mt-1.5 text-xs">
                        {tab === 'approved' ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Approved
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-red-700">
                            <XCircle className="h-3.5 w-3.5" /> Denied
                          </span>
                        )}
                        <span className="text-muted-foreground">
                          {' '}by {item.decided_by || 'Unknown'} · {decidedOn(item.decided_at)}
                        </span>
                      </p>
                    )}
                    {tab === 'denied' && item.rejection_reason && (
                      <p className="mt-1.5 inline-block rounded-md bg-red-50 px-2 py-1 text-xs text-red-800">
                        {item.rejection_reason}
                      </p>
                    )}
                  </div>
                  <ShoppingCart className="h-4 w-4 shrink-0 text-muted-foreground" />
                </div>

                {/* Pending: the decision controls (unchanged) */}
                {tab === 'pending' && (
                  rejecting?.id === item.id ? (
                    <div className="mt-3 space-y-2">
                      <input
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        placeholder="Why not? The buyer sees this."
                        autoFocus
                        className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => decide(item, 'reject', rejectReason)}
                          disabled={busyId === item.id || rejectReason.trim().length < 2}
                          className="flex-1 rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                        >
                          {busyId === item.id ? 'Rejecting…' : 'Reject with this reason'}
                        </button>
                        <button
                          onClick={() => { setRejecting(null); setRejectReason(''); }}
                          className="rounded-md border px-3 py-2 text-sm"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => decide(item, 'approve')}
                        disabled={!item.can_decide || busyId === item.id}
                        title={item.can_decide ? 'Approve this PO' : 'You can’t approve your own PO'}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {busyId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                        Approve
                      </button>
                      <button
                        onClick={() => setRejecting(item)}
                        disabled={!item.can_decide || busyId === item.id}
                        className="inline-flex items-center gap-1.5 rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        <XCircle className="h-4 w-4" /> Reject
                      </button>
                      <button
                        onClick={() => router.push(`/inventory/purchasing?po=${item.id}`)}
                        className="rounded-md border px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
                      >
                        Details
                      </button>
                    </div>
                  )
                )}

                {/* History: just a link through to the PO */}
                {isHistory && (
                  <div className="mt-3">
                    <button
                      onClick={() => router.push(`/inventory/purchasing?po=${item.id}`)}
                      className="rounded-md border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
                    >
                      View PO
                    </button>
                  </div>
                )}
              </div>
            ))}

            {/* Pagination (history) */}
            {isHistory && total > PAGE_SIZE && (
              <div className="flex items-center justify-between pt-1 text-sm text-muted-foreground">
                <button
                  onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                  disabled={offset === 0}
                  className="rounded-md border px-3 py-1.5 disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="tabular-nums">Page {pageNum} of {pageCount}</span>
                <button
                  onClick={() => setOffset((o) => o + PAGE_SIZE)}
                  disabled={offset + PAGE_SIZE >= total}
                  className="rounded-md border px-3 py-1.5 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
