'use client';

/**
 * The manager's approval inbox (rework P2, Grant 2026-08-04).
 *
 * Every PO awaiting sign-off that THIS user can act on — routed to them as
 * the buyer's HR supervisor / location approver, or all of them for admins.
 * One card per PO: who's buying, from whom, the total, and why it needs
 * approval. One tap to approve; reject requires a reason the buyer sees.
 * Phone-friendly on purpose.
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
}

export default function ApprovalsInboxPage() {
  const router = useRouter();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<InboxItem | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/inventory/purchasing/approvals', { credentials: 'include' });
      if (!res.ok) return;
      const { data } = await res.json();
      setItems(data.items || []);
      setIsAdmin(!!data.is_admin);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

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
    } finally {
      setBusyId(null);
    }
  };

  const age = (iso: string) => {
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
    return days === 0 ? 'today' : days === 1 ? '1 day' : `${days} days`;
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl space-y-6 p-2 sm:p-0">
        <PageHeader
          backHref="/inventory/purchasing"
          title="Approvals"
          description={
            items.length === 0
              ? 'Purchase orders that need your sign-off land here.'
              : `${items.length} purchase order${items.length === 1 ? '' : 's'} waiting on you${isAdmin ? ' (admin view: everything pending)' : ''}.`
          }
        />

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
            <p className="text-sm text-muted-foreground">Inbox zero — nothing needs your approval.</p>
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
                      {` · waiting ${age(item.created_at)}`}
                    </p>
                    {item.reason && (
                      <p className="mt-1.5 inline-block rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800">
                        {item.reason}
                      </p>
                    )}
                  </div>
                  <ShoppingCart className="h-4 w-4 shrink-0 text-muted-foreground" />
                </div>

                {rejecting?.id === item.id ? (
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
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
