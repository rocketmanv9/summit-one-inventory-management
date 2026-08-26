'use client';

/**
 * Vendor duplicates browser — /inventory/vendors/duplicates
 *
 * Scans the tenant's vendor book for likely-duplicate pairs (same set-based
 * signals as the add-flow matcher: name / address / domain / email / phone) and
 * ranks them by confidence. Each pair shows the two vendors side-by-side with
 * their item / PO / address / contact counts so an admin can pick the survivor,
 * preview exactly what the merge will move (rpc_merge_vendor_preview), and run
 * the transactional merge — all without leaving the page.
 *
 * Merge semantics are the shipped ones (POST /api/inventory/vendors/[id]/merge):
 * everything the duplicate owns re-points to the survivor, dupes are skipped,
 * and the duplicate is deactivated with an audit link.
 *
 * False positives get Dismissed instead ("not a duplicate" → POST
 * /api/inventory/vendors/duplicates/dismiss): the pair is persisted to
 * vendor_duplicate_dismissals and the duplicates route filters it from every
 * future scan, so it never resurfaces.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AppError } from '@rocketmanv9/chassis/errors';
import { AppShell } from '@/components/layout/AppShell';
import { CapabilityGate } from '@/components/access/CapabilityGate';
import { PageHeader } from '@/components/ui/PageHeader';
import { apiErrorMessage, errMessage } from '@/lib/client-errors';
import { ConfidenceBadge, SignalChips } from '@/components/vendors/VendorMatchCard';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Copy,
  ExternalLink,
  EyeOff,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

/** One likely-duplicate pair from rpc_vendor_duplicate_pairs. */
interface DuplicatePair {
  vendor_a_id: string;
  vendor_a_name: string;
  vendor_a_code: string | null;
  a_address: string | null;
  a_item_count: number;
  a_po_count: number;
  a_address_count: number;
  a_contact_count: number;
  vendor_b_id: string;
  vendor_b_name: string;
  vendor_b_code: string | null;
  b_address: string | null;
  b_item_count: number;
  b_po_count: number;
  b_address_count: number;
  b_contact_count: number;
  confidence: number;
  reasons: string[];
}

/** rpc_merge_vendor_preview output (via the merge route with preview: true). */
interface MergePreview {
  items_move: number;
  items_skip: number;
  contacts_move: number;
  contacts_skip: number;
  addresses_move: number;
  addresses_skip: number;
  domains_move: number;
  domains_skip: number;
  pos_move: number;
  perf_events_move: number;
  perf_metrics_move: number;
  target_vendor_name: string;
}

/** One side of a pair, normalized for rendering. */
interface PairSide {
  id: string;
  name: string;
  code: string | null;
  address: string | null;
  items: number;
  pos: number;
  addresses: number;
  contacts: number;
}

function sideA(p: DuplicatePair): PairSide {
  return {
    id: p.vendor_a_id, name: p.vendor_a_name, code: p.vendor_a_code, address: p.a_address,
    items: p.a_item_count, pos: p.a_po_count, addresses: p.a_address_count, contacts: p.a_contact_count,
  };
}

function sideB(p: DuplicatePair): PairSide {
  return {
    id: p.vendor_b_id, name: p.vendor_b_name, code: p.vendor_b_code, address: p.b_address,
    items: p.b_item_count, pos: p.b_po_count, addresses: p.b_address_count, contacts: p.b_contact_count,
  };
}

/** Heavier side (more POs, then items, then addresses) defaults to survivor. */
function defaultSurvivor(p: DuplicatePair): string {
  const a = sideA(p);
  const b = sideB(p);
  const weight = (s: PairSide) => s.pos * 1000 + s.items * 10 + s.addresses;
  return weight(b) > weight(a) ? b.id : a.id;
}

function pluralize(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** How a pair left the list this session. */
type PairResolution =
  | { kind: 'merged'; survivorName: string }
  | { kind: 'dismissed' };

/* -------------------------------------------------------------------------- */
/*  Page                                                                      */
/* -------------------------------------------------------------------------- */

export default function VendorDuplicatesPage() {
  const [pairs, setPairs] = useState<DuplicatePair[]>([]);
  const [strongThreshold, setStrongThreshold] = useState(72);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Pairs already dismissed as "not a dupe" (filtered server-side).
  const [dismissedCount, setDismissedCount] = useState(0);
  // Pair keys resolved this session (merged/dismissed) so they drop out without a rescan.
  const [resolved, setResolved] = useState<Record<string, PairResolution>>({});

  const fetchPairs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/inventory/vendors/duplicates');
      if (!res.ok) throw AppError.internal(await apiErrorMessage(res, 'Failed to scan for duplicates'));
      const json = await res.json();
      setPairs(json.pairs || []);
      setStrongThreshold(json.strongThreshold ?? 72);
      setDismissedCount(json.dismissedCount ?? 0);
      setResolved({});
    } catch (err) {
      setError(errMessage(err, 'Failed to scan for duplicates'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPairs(); }, [fetchPairs]);

  const strongPairs = useMemo(
    () => pairs.filter((p) => p.confidence >= strongThreshold),
    [pairs, strongThreshold],
  );
  const hintPairs = useMemo(
    () => pairs.filter((p) => p.confidence < strongThreshold),
    [pairs, strongThreshold],
  );

  const pairKey = (p: DuplicatePair) => `${p.vendor_a_id}:${p.vendor_b_id}`;

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Possible duplicate vendors"
          description="Pairs of vendors that look like the same company, ranked by match confidence. Merge folds the duplicate into the survivor — items, addresses, contacts, POs, and history all move. Dismiss a false positive and it never resurfaces."
          actions={
            <div className="flex items-center gap-2">
              <Link
                href="/inventory/vendors"
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm border rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
              >
                <ArrowLeft className="h-4 w-4" /> Back to vendors
              </Link>
              <button
                onClick={fetchPairs}
                disabled={loading}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm border rounded-md hover:bg-muted/30 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Rescan
              </button>
            </div>
          }
        />

        {error && (
          <div className="flex items-start gap-2 p-3 rounded-md border border-red-200 bg-red-50 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Scanning your vendors for likely duplicates…
          </div>
        ) : pairs.length === 0 ? (
          <div className="rounded-lg border bg-card p-12 text-center space-y-2">
            <ShieldCheck className="h-8 w-8 mx-auto text-emerald-500" />
            <p className="font-medium">No likely duplicates found</p>
            <p className="text-sm text-muted-foreground">
              Your vendor book is clean. New near-duplicates are also blocked at add time,
              so this page should stay quiet.
            </p>
            {dismissedCount > 0 && (
              <p className="text-xs text-muted-foreground">
                {pluralize(dismissedCount, 'pair')} previously dismissed as “not a duplicate” — hidden for good.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-8">
            {dismissedCount > 0 && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <EyeOff className="h-3.5 w-3.5" />
                {pluralize(dismissedCount, 'pair')} previously dismissed as “not a duplicate” — hidden from this list.
              </p>
            )}
            {strongPairs.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-sm font-semibold text-red-700 uppercase tracking-wide">
                  Likely duplicates ({strongPairs.length})
                </h2>
                {strongPairs.map((p) => (
                  <DuplicatePairCard
                    key={pairKey(p)}
                    pair={p}
                    strong
                    resolved={resolved[pairKey(p)]}
                    onResolved={(resolution) =>
                      setResolved((prev) => ({ ...prev, [pairKey(p)]: resolution }))}
                  />
                ))}
              </section>
            )}
            {hintPairs.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Possible matches ({hintPairs.length})
                </h2>
                {hintPairs.map((p) => (
                  <DuplicatePairCard
                    key={pairKey(p)}
                    pair={p}
                    strong={false}
                    resolved={resolved[pairKey(p)]}
                    onResolved={(resolution) =>
                      setResolved((prev) => ({ ...prev, [pairKey(p)]: resolution }))}
                  />
                ))}
              </section>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/*  Pair card                                                                 */
/* -------------------------------------------------------------------------- */

function DuplicatePairCard({
  pair,
  strong,
  resolved,
  onResolved,
}: {
  pair: DuplicatePair;
  strong: boolean;
  resolved?: PairResolution;
  onResolved: (resolution: PairResolution) => void;
}) {
  const a = sideA(pair);
  const b = sideB(pair);
  const [survivorId, setSurvivorId] = useState<string>(() => defaultSurvivor(pair));
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmingDismiss, setConfirmingDismiss] = useState(false);
  const [merging, setMerging] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [error, setError] = useState('');

  const survivor = survivorId === a.id ? a : b;
  const source = survivorId === a.id ? b : a;

  // Changing direction invalidates a fetched preview / pending confirm.
  const pickSurvivor = (id: string) => {
    if (id === survivorId) return;
    setSurvivorId(id);
    setPreview(null);
    setConfirming(false);
    setConfirmingDismiss(false);
    setError('');
  };

  const fetchPreview = async () => {
    setPreviewing(true);
    setError('');
    try {
      const res = await fetch(`/api/inventory/vendors/${source.id}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ target_vendor_id: survivor.id, preview: true }),
      });
      if (!res.ok) throw AppError.internal(await apiErrorMessage(res, 'Failed to preview merge'));
      const json = await res.json();
      setPreview(json.data as MergePreview);
    } catch (err) {
      setError(errMessage(err, 'Failed to preview merge'));
    } finally {
      setPreviewing(false);
    }
  };

  const runMerge = async () => {
    setMerging(true);
    setError('');
    try {
      const res = await fetch(`/api/inventory/vendors/${source.id}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ target_vendor_id: survivor.id }),
      });
      if (!res.ok) throw AppError.internal(await apiErrorMessage(res, 'Failed to merge vendor'));
      onResolved({ kind: 'merged', survivorName: survivor.name });
    } catch (err) {
      setError(errMessage(err, 'Failed to merge vendor'));
    } finally {
      setMerging(false);
    }
  };

  const runDismiss = async () => {
    setDismissing(true);
    setError('');
    try {
      const res = await fetch('/api/inventory/vendors/duplicates/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ vendor_a_id: pair.vendor_a_id, vendor_b_id: pair.vendor_b_id }),
      });
      if (!res.ok) throw AppError.internal(await apiErrorMessage(res, 'Failed to dismiss pair'));
      onResolved({ kind: 'dismissed' });
    } catch (err) {
      setError(errMessage(err, 'Failed to dismiss pair'));
    } finally {
      setDismissing(false);
    }
  };

  if (resolved?.kind === 'merged') {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-4 flex items-start gap-3">
        <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
        <div className="text-sm text-emerald-900">
          <p className="font-medium">Merged into {resolved.survivorName}</p>
          <p className="text-emerald-800 mt-0.5">
            {a.name} / {b.name} are now one vendor. The duplicate is inactive and audit-linked to the survivor.
          </p>
        </div>
        <Link
          href={`/inventory/vendors/${survivorId}`}
          className="ml-auto text-xs font-medium text-emerald-700 underline whitespace-nowrap"
        >
          View survivor →
        </Link>
      </div>
    );
  }

  if (resolved?.kind === 'dismissed') {
    return (
      <div className="rounded-lg border bg-muted/30 p-4 flex items-start gap-3">
        <EyeOff className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
        <div className="text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Dismissed — not a duplicate</p>
          <p className="mt-0.5">
            {a.name} and {b.name} stay separate vendors. This pair won&apos;t appear in future scans.
          </p>
        </div>
      </div>
    );
  }

  const previewLines = preview
    ? [
        { label: 'item', move: preview.items_move, skip: preview.items_skip },
        { label: 'address', move: preview.addresses_move, skip: preview.addresses_skip },
        { label: 'contact', move: preview.contacts_move, skip: preview.contacts_skip },
        { label: 'email domain', move: preview.domains_move, skip: preview.domains_skip },
        { label: 'purchase order', move: preview.pos_move, skip: 0 },
      ]
    : [];

  return (
    <div className={`rounded-lg border bg-card ${strong ? 'border-red-300' : 'border-border'}`}>
      {/* Header: confidence + signals + reasons */}
      <div className={`px-4 py-3 border-b flex flex-wrap items-center gap-2 ${strong ? 'bg-red-50/60 text-red-900' : 'bg-muted/20 text-foreground'}`}>
        <Copy className={`h-4 w-4 shrink-0 ${strong ? 'text-red-600' : 'text-muted-foreground'}`} />
        <ConfidenceBadge confidence={pair.confidence} strong={strong} />
        <SignalChips reasons={pair.reasons} />
        <span className={`text-xs ${strong ? 'text-red-800' : 'text-muted-foreground'}`}>
          {pair.reasons.join(' · ')}
        </span>
      </div>

      {/* The two vendors side-by-side, radio picks the survivor. */}
      <div className="grid gap-3 p-4 sm:grid-cols-[1fr_auto_1fr] sm:items-stretch">
        <PairSidePanel side={a} isSurvivor={survivorId === a.id} onPick={() => pickSurvivor(a.id)} />
        <div className="hidden sm:flex flex-col items-center justify-center text-muted-foreground">
          <ArrowRight className={`h-5 w-5 ${survivorId === a.id ? 'rotate-180' : ''} transition-transform`} />
          <span className="text-[10px] uppercase tracking-wide mt-1">merge</span>
        </div>
        <PairSidePanel side={b} isSurvivor={survivorId === b.id} onPick={() => pickSurvivor(b.id)} />
      </div>

      {/* Actions: preview → confirm → merge (admin-gated). */}
      <CapabilityGate capability="vendors.manage">
        <div className="px-4 pb-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{source.name}</span> will be folded into{' '}
            <span className="font-medium text-foreground">{survivor.name}</span> (the survivor keeps
            its own data; duplicates are skipped). Click a panel to switch direction.
          </p>

          {preview && (
            <div className="rounded-md border bg-muted/20 p-3 text-sm space-y-1">
              <p className="font-medium">What will move to {preview.target_vendor_name}</p>
              <ul className="space-y-0.5">
                {previewLines.map((l) => (
                  <li key={l.label} className="text-muted-foreground">
                    {pluralize(l.move, l.label)}
                    {l.skip > 0 && (
                      <span className="text-amber-700"> ({l.skip} duplicate{l.skip === 1 ? '' : 's'} skipped)</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-2.5 rounded-md border border-red-200 bg-red-50 text-xs text-red-700">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={fetchPreview}
              disabled={previewing || merging || dismissing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-md hover:bg-muted/30 transition-colors disabled:opacity-50"
            >
              {previewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {preview ? 'Refresh preview' : 'Preview merge'}
            </button>

            {!confirming ? (
              <button
                onClick={() => { setConfirming(true); setConfirmingDismiss(false); }}
                disabled={merging || previewing || dismissing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                Merge into {survivor.name}…
              </button>
            ) : (
              <span className="inline-flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5">
                <span className="text-xs font-medium text-red-800">
                  Retire “{source.name}” and move everything to “{survivor.name}”?
                </span>
                <button
                  onClick={runMerge}
                  disabled={merging}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {merging && <Loader2 className="h-3 w-3 animate-spin" />}
                  {merging ? 'Merging…' : 'Yes, merge'}
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  disabled={merging}
                  className="text-xs text-muted-foreground underline hover:text-foreground disabled:opacity-50"
                >
                  Cancel
                </button>
              </span>
            )}

            {!confirmingDismiss ? (
              <button
                onClick={() => { setConfirmingDismiss(true); setConfirming(false); }}
                disabled={merging || dismissing || previewing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors disabled:opacity-50"
                title="These are different companies — hide this pair from future scans"
              >
                <EyeOff className="h-3.5 w-3.5" /> Not a duplicate
              </button>
            ) : (
              <span className="inline-flex items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5">
                <span className="text-xs font-medium text-foreground">
                  Keep “{a.name}” and “{b.name}” separate and never show this pair again?
                </span>
                <button
                  onClick={runDismiss}
                  disabled={dismissing}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded bg-foreground text-background hover:opacity-90 disabled:opacity-50"
                >
                  {dismissing && <Loader2 className="h-3 w-3 animate-spin" />}
                  {dismissing ? 'Dismissing…' : 'Yes, dismiss'}
                </button>
                <button
                  onClick={() => setConfirmingDismiss(false)}
                  disabled={dismissing}
                  className="text-xs text-muted-foreground underline hover:text-foreground disabled:opacity-50"
                >
                  Cancel
                </button>
              </span>
            )}
          </div>
        </div>
      </CapabilityGate>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  One vendor panel                                                          */
/* -------------------------------------------------------------------------- */

function PairSidePanel({
  side,
  isSurvivor,
  onPick,
}: {
  side: PairSide;
  isSurvivor: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={`text-left rounded-lg border p-3 transition-colors ${
        isSurvivor
          ? 'border-emerald-400 bg-emerald-50/60 ring-1 ring-emerald-300'
          : 'border-border hover:border-emerald-300 hover:bg-muted/20'
      }`}
      title={isSurvivor ? 'This vendor survives the merge' : 'Click to make this vendor the survivor'}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-sm">{side.name}</span>
        {side.code && <span className="font-mono text-[10px] text-muted-foreground">{side.code}</span>}
        {isSurvivor && (
          <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-px rounded-full bg-emerald-600 text-white">
            Survivor
          </span>
        )}
        <Link
          href={`/inventory/vendors/${side.id}`}
          target="_blank"
          onClick={(e) => e.stopPropagation()}
          className="ml-auto text-muted-foreground hover:text-foreground"
          title="Open full profile in a new tab"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{side.address || 'No address on file'}</p>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span><span className="font-medium text-foreground tabular-nums">{side.items}</span> items</span>
        <span><span className="font-medium text-foreground tabular-nums">{side.pos}</span> POs</span>
        <span><span className="font-medium text-foreground tabular-nums">{side.addresses}</span> addresses</span>
        <span><span className="font-medium text-foreground tabular-nums">{side.contacts}</span> contacts</span>
      </div>
    </button>
  );
}
