'use client';

/**
 * Price wars (kits/amazon/fleet sprint, item 09).
 *
 * Two views in one page:
 *   1. CANDIDATES — items we buy from 2+ vendors, ranked by what the spread is
 *      costing us. Every price chip is a real vendor_items row or a real PO line.
 *   2. THE ARENA — one open round: a leaderboard sorted by the live low bid,
 *      per-vendor cards with the AI-drafted message (Copy + mailto), a
 *      "record response" box that reads a pasted reply, and "AI counter" that
 *      drafts the next volley for the rivals citing the real recorded low.
 *
 * The AI drafts each vendor's message; the arena then SENDS the invites by email
 * (reusing the PO email transport — tenant Gmail preferred, Resend fallback) so
 * the vendors really do bid against each other. Copy / open-in-mail stays as a
 * fallback for vendors with no email, and the AI still never invents a price.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Swords,
  Crown,
  Loader2,
  RefreshCw,
  Sparkles,
  Copy,
  Mail,
  Check,
  TrendingDown,
  ArrowLeft,
  Trophy,
  X,
  ClipboardPaste,
  ShoppingCart,
  AlertTriangle,
  Flame,
  Send,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { apiWrite } from '@/lib/api-client';
import { StartWarModal } from '@/components/purchasing/StartWarModal';

// ── Types (mirror the route payloads) ────────────────────────────────────────

interface VendorPrice {
  vendor_id: string;
  vendor_name: string;
  contact_email: string | null;
  best_unit_cost: number;
  last_unit_cost: number;
  catalog_unit_cost: number | null;
  qty_last_12m: number;
  spend_last_12m: number;
  is_low: boolean;
}

interface Candidate {
  catalog_item_id: string;
  name: string;
  sku: string | null;
  vendor_count: number;
  low_unit_cost: number;
  high_unit_cost: number;
  spread_pct: number;
  qty_last_12m: number;
  spend_last_12m: number;
  potential_savings_12m: number;
  vendors: VendorPrice[];
  open_round_id: string | null;
}

interface Bid {
  id: string;
  vendor_id: string;
  vendor_name: string;
  status: 'invited' | 'quoted' | 'declined';
  baseline_unit_cost: number | null;
  current_quote: number | null;
  draft_message: string | null;
  message_history: any[];
  quote_history: any[];
  contact_email: string | null;
  notes: string | null;
  sent_at: string | null;
  sent_method: 'gmail' | 'resend' | null;
  sent_to_email: string | null;
}

interface Standing {
  bid_id: string;
  vendor_id: string;
  vendor_name: string;
  status: string;
  baseline_unit_cost: number | null;
  current_quote: number | null;
  move_pct: number | null;
  is_low: boolean;
  rank: number | null;
}

interface RoundSummary {
  id: string;
  catalog_item_id: string;
  request_id: string | null;
  item_name: string | null;
  item_sku: string | null;
  status: 'open' | 'awarded' | 'abandoned';
  target_qty: number;
  baseline_unit_cost: number | null;
  awarded_vendor_id: string | null;
  awarded_vendor_name: string | null;
  awarded_unit_cost: number | null;
  awarded_po_id: string | null;
  closed_at: string | null;
  created_at: string;
  bid_count: number;
  quoted_count: number;
  standings: Standing[];
}

const money = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? '—'
    : `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const money0 = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? '—'
    : `$${Math.round(Number(n)).toLocaleString()}`;

async function readJson(res: Response) {
  const text = await res.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { error: text }; }
  if (!res.ok) {
    return { ok: false as const, message: json?.error?.message || json?.error || json?.message || `Request failed (${res.status})`, json };
  }
  return { ok: true as const, json };
}

export default function PriceWarsPage() {
  return (
    <AppShell>
      <PriceWarsContent />
    </AppShell>
  );
}

function PriceWarsContent() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [summary, setSummary] = useState<{ candidate_count: number; total_potential_savings_12m: number; window_months: number } | null>(null);
  const [rounds, setRounds] = useState<RoundSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [openRoundId, setOpenRoundId] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [showStart, setShowStart] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [cRes, rRes] = await Promise.all([
        fetch('/api/inventory/price-wars/candidates?limit=25', { credentials: 'include' }),
        fetch('/api/inventory/price-wars/rounds', { credentials: 'include' }),
      ]);
      const c = await readJson(cRes);
      const r = await readJson(rRes);
      if (!c.ok) { setError(c.message); return; }
      setCandidates((c.json.data?.candidates ?? []) as Candidate[]);
      setSummary(c.json.data?.summary ?? null);
      if (r.ok) setRounds((r.json.data ?? []) as RoundSummary[]);
    } catch (e: any) {
      setError(e?.message || 'Could not load price wars.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const startWar = async (c: Candidate) => {
    if (c.open_round_id) { setOpenRoundId(c.open_round_id); return; }
    setStarting(c.catalog_item_id);
    setError('');
    setNotice('');
    try {
      const res = await apiWrite('/api/inventory/price-wars/rounds', {
        method: 'POST',
        body: {
          catalog_item_id: c.catalog_item_id,
          vendor_ids: c.vendors.map((v) => v.vendor_id).slice(0, 12),
        },
      });
      const result = await readJson(res);
      if (!result.ok) { setError(result.message); return; }
      setNotice(`Price war open on ${c.name} — ${result.json.data?.vendor_count} vendors in the ring.`);
      setOpenRoundId(result.json.data?.round_id ?? null);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Could not start the price war.');
    } finally {
      setStarting(null);
    }
  };

  if (openRoundId) {
    return (
      <Arena
        roundId={openRoundId}
        allRounds={rounds}
        onNavigate={(id) => setOpenRoundId(id)}
        onBack={() => { setOpenRoundId(null); load(); }}
      />
    );
  }

  const openRounds = rounds.filter((r) => r.status === 'open');
  const closedRounds = rounds.filter((r) => r.status !== 'open');

  return (
    <div className="p-6">
      <PageHeader
        title="Price wars"
        description="Items we buy from more than one vendor, at more than one price. Start a round, let them bid each other down, award the winner — the winning price becomes the price we buy at."
        actions={
          candidates.length > 0 ? (
            <button
              onClick={() => setShowStart(true)}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90"
            >
              <Swords className="h-4 w-4" /> Start a price war
            </button>
          ) : null
        }
      />

      <StartWarModal
        open={showStart}
        candidates={candidates}
        onClose={() => setShowStart(false)}
        onStarted={(anchor, _requestId) => {
          setShowStart(false);
          setNotice('Price war open — draft invites are on each vendor. Send the invites to put them in the ring.');
          if (anchor) setOpenRoundId(anchor);
          load();
        }}
      />

      {/* Headline — the money on the table. */}
      {summary && summary.candidate_count > 0 && (
        <div className="mb-5 overflow-hidden rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 via-orange-50 to-rose-50">
          <div className="flex flex-wrap items-center gap-6 p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600">
                <Flame className="h-6 w-6" />
              </div>
              <div>
                <div className="text-2xl font-bold text-gray-900">{money0(summary.total_potential_savings_12m)}</div>
                <div className="text-xs font-medium uppercase tracking-wide text-amber-700">on the table, last {summary.window_months} months</div>
              </div>
            </div>
            <div className="h-10 w-px bg-amber-200" />
            <div>
              <div className="text-2xl font-bold text-gray-900">{summary.candidate_count}</div>
              <div className="text-xs font-medium uppercase tracking-wide text-amber-700">items with two or more prices</div>
            </div>
            {openRounds.length > 0 && (
              <>
                <div className="h-10 w-px bg-amber-200" />
                <div>
                  <div className="text-2xl font-bold text-gray-900">{openRounds.length}</div>
                  <div className="text-xs font-medium uppercase tracking-wide text-amber-700">wars in progress</div>
                </div>
              </>
            )}
            <button
              onClick={load}
              className="ml-auto inline-flex items-center gap-2 rounded-md border border-amber-300 bg-white/70 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-white"
            >
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 p-8 text-gray-500"><Loader2 className="h-5 w-5 animate-spin" /> Scanning what we buy…</div>
      ) : (
        <>
          {/* Live rounds first — a war in progress outranks a new idea. */}
          {openRounds.length > 0 && (
            <section className="mb-8">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
                <Swords className="h-4 w-4" /> In the ring
              </h2>
              <div className="grid gap-3 md:grid-cols-2">
                {openRounds.map((r) => {
                  const low = r.standings.find((s) => s.is_low);
                  return (
                    <button
                      key={r.id}
                      onClick={() => setOpenRoundId(r.id)}
                      className="rounded-lg border-2 border-orange-300 bg-orange-50/60 p-4 text-left transition hover:border-orange-400 hover:shadow-md"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-gray-900">{r.item_name ?? 'Item'}</div>
                          <div className="text-xs text-gray-500">{r.item_sku}</div>
                        </div>
                        <span className="rounded-full bg-orange-500 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">Live</span>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                        <span className="text-gray-600">{r.quoted_count}/{r.bid_count} quoted</span>
                        {low && (
                          <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                            <Crown className="h-4 w-4 text-amber-500" /> {low.vendor_name} {money(low.current_quote)}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          <section>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
              <TrendingDown className="h-4 w-4" /> Worth a fight
            </h2>
            {candidates.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
                Nothing to fight over yet — every item we buy has a price from a single vendor, or the vendors already agree.
                Add a second vendor price to an item (Vendor Items) and it will show up here.
              </div>
            ) : (
              <div className="space-y-3">
                {candidates.map((c) => (
                  <CandidateCard
                    key={c.catalog_item_id}
                    candidate={c}
                    busy={starting === c.catalog_item_id}
                    onStart={() => startWar(c)}
                  />
                ))}
              </div>
            )}
          </section>

          {closedRounds.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
                <Trophy className="h-4 w-4" /> Settled
              </h2>
              <div className="space-y-2">
                {closedRounds.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setOpenRoundId(r.id)}
                    className="flex w-full flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 text-left text-sm hover:border-gray-300"
                  >
                    <span className="font-medium text-gray-900">{r.item_name ?? 'Item'}</span>
                    {r.status === 'awarded' ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        <Crown className="h-3 w-3 text-amber-500" /> {r.awarded_vendor_name} won at {money(r.awarded_unit_cost)}
                      </span>
                    ) : (
                      <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-500">Abandoned</span>
                    )}
                    <span className="ml-auto text-xs text-gray-400">{new Date(r.closed_at ?? r.created_at).toLocaleDateString()}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

// ── Candidate card ───────────────────────────────────────────────────────────

function CandidateCard({ candidate: c, busy, onStart }: { candidate: Candidate; busy: boolean; onStart: () => void }) {
  const heat = c.spread_pct >= 50 ? 'border-rose-300 bg-rose-50/40' : c.spread_pct >= 20 ? 'border-amber-300 bg-amber-50/40' : 'border-gray-200 bg-white';
  return (
    <div className={`rounded-lg border-2 p-4 ${heat}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-gray-900">{c.name}</div>
          <div className="text-xs text-gray-500">
            {c.sku ? `${c.sku} · ` : ''}{c.vendor_count} vendors
            {c.qty_last_12m > 0 ? ` · ${c.qty_last_12m.toLocaleString()} units bought (12mo, ${money0(c.spend_last_12m)})` : ' · no purchases in the last 12 months'}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-lg font-bold text-rose-600">{c.spread_pct.toFixed(0)}%</div>
            <div className="text-[11px] uppercase tracking-wide text-gray-500">spread</div>
          </div>
          {c.potential_savings_12m > 0 && (
            <div className="text-right">
              <div className="text-lg font-bold text-emerald-600">{money0(c.potential_savings_12m)}</div>
              <div className="text-[11px] uppercase tracking-wide text-gray-500">savings/yr</div>
            </div>
          )}
          <button
            onClick={onStart}
            disabled={busy}
            className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold text-white disabled:opacity-60 ${
              c.open_round_id ? 'bg-orange-500 hover:bg-orange-600' : 'bg-primary hover:bg-primary/90'
            }`}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Swords className="h-4 w-4" />}
            {c.open_round_id ? 'Open the arena' : 'Start a price war'}
          </button>
        </div>
      </div>

      {/* The prices themselves — crown on the cheapest. */}
      <div className="mt-3 flex flex-wrap gap-2">
        {c.vendors.map((v) => (
          <span
            key={v.vendor_id}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
              v.is_low ? 'border-emerald-300 bg-emerald-50 font-semibold text-emerald-800' : 'border-gray-200 bg-white text-gray-700'
            }`}
            title={v.qty_last_12m > 0 ? `${v.qty_last_12m} units / ${money(v.spend_last_12m)} in the last 12 months` : 'No purchases in the last 12 months'}
          >
            {v.is_low && <Crown className="h-3.5 w-3.5 text-amber-500" />}
            {v.vendor_name}
            <span className="font-mono">{money(v.best_unit_cost)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ── The arena ────────────────────────────────────────────────────────────────

function Arena({ roundId, allRounds, onNavigate, onBack }: {
  roundId: string;
  allRounds: RoundSummary[];
  onNavigate: (roundId: string) => void;
  onBack: () => void;
}) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [awarding, setAwarding] = useState<string | null>(null);
  const [createPO, setCreatePO] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/inventory/price-wars/rounds/${roundId}`, { credentials: 'include' });
      const result = await readJson(res);
      if (!result.ok) { setError(result.message); return; }
      setData(result.json.data);
    } catch (e: any) {
      setError(e?.message || 'Could not load the arena.');
    } finally {
      setLoading(false);
    }
  }, [roundId]);

  useEffect(() => { load(); }, [load]);

  const round = data?.round;
  const bids: Bid[] = data?.bids ?? [];
  const standings: Standing[] = data?.standings ?? [];
  const low = data?.current_low ?? null;

  const bidById = useMemo(() => new Map(bids.map((b) => [b.id, b])), [bids]);

  // Vendors we can actually email right now: has a draft, has an email, not sent.
  const sendable = useMemo(
    () => bids.filter((b) => b.status !== 'declined' && !!b.draft_message && !!b.contact_email && !b.sent_at),
    [bids],
  );
  const sentCount = useMemo(() => bids.filter((b) => !!b.sent_at).length, [bids]);

  // Sibling products: other rounds sharing this round's request_id. This is what
  // makes a multi-product war navigable — each product keeps its own arena.
  const thisRound = allRounds.find((r) => r.id === roundId);
  const siblings = useMemo(() => {
    const rid = thisRound?.request_id ?? round?.request_id ?? null;
    if (!rid) return [] as RoundSummary[];
    return allRounds.filter((r) => r.request_id === rid);
  }, [allRounds, thisRound, round, roundId]);

  const draft = async (bidId: string, kind: 'rfq' | 'counter') => {
    setBusy(`${bidId}:draft`);
    setError('');
    setNotice('');
    try {
      const res = await apiWrite('/api/inventory/price-wars/draft-message', {
        method: 'POST',
        body: { round_id: roundId, bid_id: bidId, kind },
      });
      const result = await readJson(res);
      if (!result.ok) { setError(result.message); return; }
      if (result.json.data?.message) setNotice(result.json.data.message);
      else setNotice(kind === 'rfq' ? 'Opening message drafted — copy it into your email.' : 'Counter drafted with the current low cited.');
      await load();
    } catch (e: any) {
      setError(e?.message || 'Drafting failed.');
    } finally {
      setBusy(null);
    }
  };

  const counterEveryoneElse = async () => {
    if (!low) return;
    const targets = bids.filter((b) => b.vendor_id !== low.vendor_id && b.status !== 'declined');
    setBusy('counter-all');
    setError('');
    try {
      for (const b of targets) {
        const res = await apiWrite('/api/inventory/price-wars/draft-message', {
          method: 'POST',
          body: { round_id: roundId, bid_id: b.id, kind: 'counter' },
        });
        const result = await readJson(res);
        if (!result.ok) { setError(result.message); break; }
      }
      setNotice(`Counters drafted for ${targets.length} vendor(s), citing the ${money(low.unit_cost)} we actually hold.`);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Drafting counters failed.');
    } finally {
      setBusy(null);
    }
  };

  const recordQuote = async (bidId: string, payload: any) => {
    setBusy(`${bidId}:record`);
    setError('');
    try {
      const res = await apiWrite(`/api/inventory/price-wars/rounds/${roundId}`, { method: 'PATCH', body: { bid_id: bidId, ...payload } });
      const result = await readJson(res);
      if (!result.ok) { setError(result.message); return false; }
      setNotice(payload.declined ? 'Marked as declined.' : 'Quote recorded — leaderboard updated.');
      await load();
      return true;
    } catch (e: any) {
      setError(e?.message || 'Could not record that.');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const award = async (vendorId: string) => {
    setAwarding(vendorId);
    setError('');
    try {
      const res = await apiWrite(`/api/inventory/price-wars/rounds/${roundId}/award`, {
        method: 'POST',
        body: { vendor_id: vendorId, create_po: createPO },
      });
      const result = await readJson(res);
      if (!result.ok) { setError(result.message); return; }
      const d = result.json.data;
      setNotice(
        `Awarded at ${money(d.unit_cost)}${d.previous_unit_cost !== null ? ` (was ${money(d.previous_unit_cost)})` : ''}. ` +
        `Vendor price updated.${d.purchase_order?.po_number ? ` PO ${d.purchase_order.po_number} created (${(d.purchase_order.status ?? 'draft').replace('_', ' ')}) — it still needs approval, nothing was sent to the vendor.` : ''}`,
      );
      await load();
    } catch (e: any) {
      setError(e?.message || 'Could not award the round.');
    } finally {
      setAwarding(null);
    }
  };

  const abandon = async () => {
    setBusy('abandon');
    try {
      const res = await apiWrite(`/api/inventory/price-wars/rounds/${roundId}`, { method: 'PATCH', body: { abandon: true } });
      const result = await readJson(res);
      if (!result.ok) { setError(result.message); return; }
      setNotice('Round abandoned.');
      await load();
    } finally {
      setBusy(null);
    }
  };

  // Actually email the drafted RFQ to vendors — the whole point of this feature.
  // bidIds omitted = every invited vendor with a draft and an email.
  const sendInvites = async (bidIds?: string[]) => {
    setBusy(bidIds && bidIds.length === 1 ? `${bidIds[0]}:send` : 'send-all');
    setError('');
    setNotice('');
    try {
      const res = await apiWrite(`/api/inventory/price-wars/rounds/${roundId}/send-invites`, {
        method: 'POST',
        body: bidIds ? { bid_ids: bidIds } : {},
      });
      const result = await readJson(res);
      if (!result.ok) { setError(result.message); return; }
      const d = result.json.data;
      if (d?.message) setNotice(d.message);
      else setNotice(`Sent ${d?.sent_count ?? 0} invite(s).`);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Sending invites failed.');
    } finally {
      setBusy(null);
    }
  };

  if (loading && !data) {
    return <div className="flex items-center gap-2 p-8 text-gray-500"><Loader2 className="h-5 w-5 animate-spin" /> Loading the arena…</div>;
  }

  return (
    <div className="p-6">
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
        <ArrowLeft className="h-4 w-4" /> All price wars
      </button>

      {/* Multi-product war: switch between the products in this request. Each
          product keeps its own leaderboard, quotes and award. */}
      {siblings.length > 1 && (
        <div className="mb-4">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
            <Swords className="h-3.5 w-3.5" /> {siblings.length} products in this war
          </div>
          <div className="flex flex-wrap gap-2">
            {siblings.map((s) => {
              const active = s.id === roundId;
              return (
                <button
                  key={s.id}
                  onClick={() => { if (!active) onNavigate(s.id); }}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition ${
                    active ? 'border-primary bg-primary text-white font-semibold' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                  }`}
                >
                  {s.status === 'awarded' && <Trophy className="h-3.5 w-3.5 text-amber-400" />}
                  {s.item_name ?? 'Item'}
                  <span className={`text-[11px] ${active ? 'text-white/80' : 'text-gray-400'}`}>{s.quoted_count}/{s.bid_count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <PageHeader
        title={round?.item_name ?? 'Price war'}
        description={
          round?.status === 'open'
            ? `${bids.length} vendors bidding on ${Number(round?.target_qty ?? 1).toLocaleString()} units. Draft each message, then send the invites — the vendors get the RFQ by email and bid against each other.`
            : round?.status === 'awarded'
              ? `Awarded to ${round?.awarded_vendor_name ?? 'a vendor'} at ${money(round?.awarded_unit_cost)}.`
              : 'This round was abandoned.'
        }
      />

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}
      {notice && <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}

      {/* Scoreboard */}
      <div className="mb-5 rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center gap-6">
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">What we pay today</div>
            <div className="text-xl font-bold text-gray-900">{money(round?.baseline_unit_cost)}</div>
          </div>
          <div className="text-2xl text-gray-300">→</div>
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">Current low</div>
            <div className="flex items-center gap-2 text-xl font-bold text-emerald-600">
              {low ? <><Crown className="h-5 w-5 text-amber-500" />{money(low.unit_cost)}</> : <span className="text-gray-400">no quotes yet</span>}
            </div>
            {low && <div className="text-xs text-gray-500">{low.vendor_name}</div>}
          </div>
          {data?.savings_so_far ? (
            <div className="ml-auto rounded-lg bg-emerald-50 px-4 py-2 text-right">
              <div className="text-xl font-bold text-emerald-700">{money0(data.savings_so_far)}</div>
              <div className="text-[11px] uppercase tracking-wide text-emerald-600">saved on this volume</div>
            </div>
          ) : null}
        </div>

        {/* Leaderboard */}
        <div className="space-y-1.5">
          {standings.map((s) => {
            const pct = round?.baseline_unit_cost && s.current_quote
              ? Math.max(6, Math.min(100, (s.current_quote / Number(round.baseline_unit_cost)) * 100))
              : 100;
            return (
              <div key={s.bid_id} className="flex items-center gap-3">
                <div className="w-8 shrink-0 text-right text-sm font-bold text-gray-400">{s.rank ? `#${s.rank}` : '—'}</div>
                <div className="w-48 shrink-0 truncate text-sm font-medium text-gray-800">
                  {s.is_low && <Crown className="mr-1 inline h-4 w-4 text-amber-500" />}
                  {s.vendor_name}
                </div>
                <div className="h-6 flex-1 overflow-hidden rounded bg-gray-100">
                  <div
                    className={`h-full rounded transition-all duration-500 ${s.is_low ? 'bg-emerald-500' : s.status === 'declined' ? 'bg-gray-300' : s.current_quote !== null ? 'bg-sky-400' : 'bg-gray-200'}`}
                    style={{ width: `${s.current_quote !== null ? pct : 100}%` }}
                  />
                </div>
                <div className="w-40 shrink-0 text-right text-sm">
                  {s.status === 'declined' ? (
                    <span className="text-gray-400">declined</span>
                  ) : s.current_quote !== null ? (
                    <>
                      <span className={`font-mono font-semibold ${s.is_low ? 'text-emerald-700' : 'text-gray-800'}`}>{money(s.current_quote)}</span>
                      {s.move_pct !== null && s.move_pct < 0 && (
                        <span className="ml-1 text-xs font-medium text-emerald-600">{s.move_pct.toFixed(0)}%</span>
                      )}
                    </>
                  ) : (
                    <span className="text-gray-400">waiting · was {money(s.baseline_unit_cost)}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {round?.status === 'open' && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
            <button
              onClick={counterEveryoneElse}
              disabled={!low || busy === 'counter-all'}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
              title={low ? 'Draft a counter for everyone except the current low bidder' : 'Record at least one quote first'}
            >
              {busy === 'counter-all' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              AI counter the rivals
            </button>
            <label className="ml-auto inline-flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={createPO} onChange={(e) => setCreatePO(e.target.checked)} className="rounded border-gray-300" />
              Draft a PO when awarding
            </label>
            <button onClick={abandon} disabled={busy === 'abandon'} className="rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">
              Abandon round
            </button>
          </div>
        )}
      </div>

      {/* Send-invites banner — the AI drafts, then this page actually emails
          each vendor so they really bid against each other. Copy / open-in-mail
          stays as a fallback for vendors with no email on file. */}
      {round?.status === 'open' && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
          <Send className="h-4 w-4 shrink-0" />
          <span className="flex-1 min-w-[12rem]">
            <strong>Send the invites.</strong> The AI drafted the message on each vendor — send them all and the vendors bid against each other.
            {sentCount > 0 && <span className="ml-1 text-sky-700">{sentCount} sent so far.</span>}
            {sendable.length === 0 && sentCount === 0 && <span className="ml-1 text-sky-700">Draft a message on each vendor first (and add their email).</span>}
          </span>
          <button
            onClick={() => sendInvites()}
            disabled={sendable.length === 0 || busy === 'send-all'}
            className="inline-flex items-center gap-2 rounded-md bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
            title={sendable.length > 0 ? `Email the drafted RFQ to ${sendable.length} vendor(s)` : 'No vendor is ready to send yet'}
          >
            {busy === 'send-all' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {sendable.length > 0 ? `Send invites (${sendable.length})` : 'Send invites'}
          </button>
        </div>
      )}

      {/* Vendor cards */}
      <div className="grid gap-4 lg:grid-cols-2">
        {standings.map((s) => {
          const bid = bidById.get(s.bid_id);
          if (!bid) return null;
          return (
            <VendorCard
              key={bid.id}
              bid={bid}
              standing={s}
              roundOpen={round?.status === 'open'}
              isWinner={round?.awarded_vendor_id === bid.vendor_id}
              itemName={round?.item_name ?? ''}
              busy={busy}
              awarding={awarding}
              onDraft={draft}
              onRecord={recordQuote}
              onAward={award}
              onSend={(bidId) => sendInvites([bidId])}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── One vendor in the ring ───────────────────────────────────────────────────

function VendorCard({
  bid, standing, roundOpen, isWinner, itemName, busy, awarding, onDraft, onRecord, onAward, onSend,
}: {
  bid: Bid;
  standing: Standing;
  roundOpen: boolean;
  isWinner: boolean;
  itemName: string;
  busy: string | null;
  awarding: string | null;
  onDraft: (bidId: string, kind: 'rfq' | 'counter') => void;
  onRecord: (bidId: string, payload: any) => Promise<boolean>;
  onAward: (vendorId: string) => void;
  onSend: (bidId: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [manual, setManual] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState<any>(null);
  const [showRecord, setShowRecord] = useState(false);

  const hasDraft = !!bid.draft_message;
  const subject = hasDraft ? bid.draft_message!.split('\n')[0] : '';
  const bodyText = hasDraft ? bid.draft_message!.split('\n').slice(2).join('\n') : '';

  const copy = async () => {
    if (!bid.draft_message) return;
    try {
      await navigator.clipboard.writeText(bid.draft_message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked — the textarea is still selectable */ }
  };

  const mailto = hasDraft && bid.contact_email
    ? `mailto:${encodeURIComponent(bid.contact_email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`
    : null;

  const runExtract = async () => {
    setExtracting(true);
    setExtracted(null);
    try {
      const res = await fetch('/api/inventory/price-wars/extract-quote', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: replyText, item_name: itemName, vendor_name: bid.vendor_name }),
      });
      const result = await readJson(res);
      setExtracted(result.ok ? result.json : { message: result.message, unit_cost: null, confidence: 0 });
    } catch (e: any) {
      setExtracted({ message: e?.message || 'Extraction failed — type the number in.', unit_cost: null, confidence: 0 });
    } finally {
      setExtracting(false);
    }
  };

  return (
    <div className={`rounded-xl border-2 p-4 ${
      isWinner ? 'border-emerald-400 bg-emerald-50/50'
        : standing.is_low ? 'border-amber-300 bg-amber-50/30'
        : bid.status === 'declined' ? 'border-gray-200 bg-gray-50/60'
        : 'border-gray-200 bg-white'
    }`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-base font-semibold text-gray-900">
            {(standing.is_low || isWinner) && <Crown className="h-5 w-5 text-amber-500" />}
            {bid.vendor_name}
          </div>
          <div className="text-xs text-gray-500">
            {bid.contact_email ?? <span className="text-amber-600">no contact email on file</span>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
            bid.status === 'quoted' ? 'border-sky-200 bg-sky-50 text-sky-700'
              : bid.status === 'declined' ? 'border-gray-200 bg-gray-100 text-gray-500'
              : 'border-amber-200 bg-amber-50 text-amber-700'
          }`}>
            {bid.status === 'quoted' ? 'Quoted' : bid.status === 'declined' ? 'Out' : 'Invited'}
          </span>
          {bid.sent_at ? (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700"
              title={`Emailed ${bid.sent_to_email ?? ''}${bid.sent_method ? ` via ${bid.sent_method}` : ''}`}
            >
              <Send className="h-3 w-3" /> Sent · {new Date(bid.sent_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </span>
          ) : bid.draft_message ? (
            <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-500">Draft</span>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex items-baseline gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-gray-500">Their price with us</div>
          <div className="font-mono text-sm text-gray-600">{money(bid.baseline_unit_cost)}</div>
        </div>
        <div className="text-gray-300">→</div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-gray-500">Now quoting</div>
          <div className={`font-mono text-lg font-bold ${standing.is_low ? 'text-emerald-700' : 'text-gray-900'}`}>
            {money(bid.current_quote)}
          </div>
        </div>
        {standing.move_pct !== null && standing.move_pct < 0 && (
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-semibold text-emerald-700">
            {standing.move_pct.toFixed(0)}%
          </span>
        )}
      </div>

      {roundOpen && (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => onDraft(bid.id, bid.status === 'quoted' || hasDraft ? 'counter' : 'rfq')}
              disabled={busy === `${bid.id}:draft`}
              className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
            >
              {busy === `${bid.id}:draft` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {hasDraft ? 'Draft next volley' : 'AI draft the ask'}
            </button>
            {hasDraft && bid.contact_email && !bid.sent_at && (
              <button
                onClick={() => onSend(bid.id)}
                disabled={busy === `${bid.id}:send`}
                className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-2.5 py-1.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
                title={`Email this RFQ to ${bid.contact_email}`}
              >
                {busy === `${bid.id}:send` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Send
              </button>
            )}
            <button
              onClick={() => setShowRecord((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              <ClipboardPaste className="h-4 w-4" /> Record response
            </button>
            {bid.status !== 'declined' && (
              <button
                onClick={() => onRecord(bid.id, { declined: true })}
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1.5 text-sm text-gray-500 hover:bg-gray-50"
              >
                <X className="h-4 w-4" /> They passed
              </button>
            )}
            {bid.current_quote !== null && (
              <button
                onClick={() => onAward(bid.vendor_id)}
                disabled={awarding === bid.vendor_id}
                className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {awarding === bid.vendor_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trophy className="h-4 w-4" />}
                Award
              </button>
            )}
          </div>

          {/* The draft */}
          {hasDraft && (
            <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Draft — you send it</span>
                <button onClick={copy} className="ml-auto inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-100">
                  {copied ? <><Check className="h-3.5 w-3.5 text-emerald-600" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
                </button>
                {mailto && (
                  <a href={mailto} className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-100">
                    <Mail className="h-3.5 w-3.5" /> Open in mail
                  </a>
                )}
              </div>
              <textarea
                readOnly
                value={bid.draft_message ?? ''}
                rows={9}
                className="w-full resize-y rounded border border-gray-200 bg-white p-2 font-mono text-xs text-gray-800"
              />
              {Array.isArray(bid.message_history) && bid.message_history.length > 1 && (
                <div className="mt-1 text-[11px] text-gray-400">{bid.message_history.length} drafts in this round</div>
              )}
            </div>
          )}

          {/* Record a response */}
          {showRecord && (
            <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50/50 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-sky-800">What did they say?</div>
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                rows={4}
                placeholder="Paste their reply here — the AI pulls out the unit price, MOQ and lead time."
                className="w-full resize-y rounded border border-gray-200 bg-white p-2 text-sm"
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  onClick={runExtract}
                  disabled={!replyText.trim() || extracting}
                  className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-2.5 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                >
                  {extracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Read the price
                </button>
                <span className="text-xs text-gray-500">or</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={manual}
                  onChange={(e) => setManual(e.target.value)}
                  placeholder="unit price"
                  className="w-28 rounded border border-gray-200 px-2 py-1.5 text-sm"
                />
                <button
                  onClick={async () => {
                    const n = Number(manual);
                    if (!Number.isFinite(n) || n <= 0) return;
                    const ok = await onRecord(bid.id, { quote: { unit_cost: n, source: 'manual' } });
                    if (ok) { setManual(''); setShowRecord(false); setReplyText(''); setExtracted(null); }
                  }}
                  disabled={!manual || busy === `${bid.id}:record`}
                  className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-white disabled:opacity-50"
                >
                  Record it
                </button>
              </div>

              {extracted && (
                <div className="mt-2 rounded border border-gray-200 bg-white p-2 text-sm">
                  {extracted.unit_cost !== null && extracted.unit_cost !== undefined ? (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-lg font-bold text-gray-900">{money(extracted.unit_cost)}</span>
                        <span className="text-xs text-gray-500">/unit</span>
                        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${extracted.confidence >= 60 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                          {extracted.confidence}% confident
                        </span>
                        {extracted.moq ? <span className="text-xs text-gray-600">MOQ {extracted.moq}</span> : null}
                        {extracted.lead_time_days !== null && extracted.lead_time_days !== undefined ? <span className="text-xs text-gray-600">{extracted.lead_time_days}d lead</span> : null}
                        <button
                          onClick={async () => {
                            const ok = await onRecord(bid.id, {
                              quote: {
                                unit_cost: Number(extracted.unit_cost),
                                source: 'extracted',
                                moq: extracted.moq ?? null,
                                lead_time_days: extracted.lead_time_days ?? null,
                                confidence: extracted.confidence ?? null,
                                raw: replyText,
                              },
                            });
                            if (ok) { setShowRecord(false); setReplyText(''); setExtracted(null); }
                          }}
                          disabled={busy === `${bid.id}:record`}
                          className="ml-auto rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                        >
                          Confirm &amp; record
                        </button>
                      </div>
                      {extracted.evidence && <div className="mt-1 border-l-2 border-gray-200 pl-2 text-xs italic text-gray-500">“{extracted.evidence}”</div>}
                      {extracted.notes && <div className="mt-1 text-xs text-gray-600">{extracted.notes}</div>}
                    </>
                  ) : (
                    <div className="text-xs text-amber-700">{extracted.message ?? 'No price found — type it in above.'}</div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Final standings once closed */}
      {!roundOpen && (
        <div className="mt-3 text-sm">
          {isWinner ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-white">
              <Trophy className="h-3.5 w-3.5" /> Won the business
            </span>
          ) : (
            <span className="text-xs text-gray-500">
              Final: {bid.current_quote !== null ? money(bid.current_quote) : 'no quote'} · #{standing.rank ?? '—'}
            </span>
          )}
        </div>
      )}

      {bid.status === 'quoted' && Array.isArray(bid.quote_history) && bid.quote_history.length > 1 && (
        <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px] text-gray-500">
          <span className="uppercase tracking-wide">Volleys:</span>
          {bid.quote_history.map((q: any, i: number) => (
            <span key={i} className="rounded bg-gray-100 px-1.5 py-0.5 font-mono">{money(q.unit_cost)}</span>
          ))}
        </div>
      )}

      {!roundOpen && bid.draft_message && (
        <div className="mt-2 text-[11px] text-gray-400">{Array.isArray(bid.message_history) ? bid.message_history.length : 0} message(s) drafted</div>
      )}

      {roundOpen && !hasDraft && bid.status === 'invited' && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-gray-400">
          <ShoppingCart className="h-3.5 w-3.5" /> No message drafted yet
        </div>
      )}
    </div>
  );
}
