'use client';

/**
 * VendorMatchCard — the shared "this looks like an existing vendor" card.
 *
 * Renders one confidence-scored duplicate match: a visually-weighted confidence
 * badge (strong >= 72 red/prominent, hint >= 45 subtle), chips for WHICH signals
 * matched (name / address / domain / email / phone — parsed from the matcher's
 * human-readable reasons), the reasons themselves, and per-match actions the
 * caller wires in (Use existing / Add as branch / View vendor).
 *
 * Used by the quick-add duplicate gate and the full VendorModal's 409 recovery
 * panel; the duplicates browser reuses the badge + signal parsing.
 */

import { Building2, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react';
import type { VendorMatchResult } from '@/lib/vendor-draft';

/** Signal keys the SQL matcher scores on. */
export type MatchSignal = 'name' | 'address' | 'domain' | 'email' | 'phone';

const SIGNAL_LABEL: Record<MatchSignal, string> = {
  name: 'Name',
  address: 'Address',
  domain: 'Website',
  email: 'Email',
  phone: 'Phone',
};

/**
 * Parse the matcher's human-readable reasons into signal chips. The reason
 * strings are produced by rpc_vendor_match_candidates / rpc_vendor_duplicate_pairs
 * ('Name overlaps…', 'Similar name(s)…', 'One name contains the other',
 * 'Address already on file…', 'Same street address on file', 'Website domain
 * matches…', 'Domain matches…', 'Email domain matches…', 'Phone number matches').
 */
export function matchSignals(reasons: string[] | null | undefined): MatchSignal[] {
  const out = new Set<MatchSignal>();
  for (const r of reasons || []) {
    if (/^(exact name|name overlaps|similar names?|one name contains)/i.test(r)) out.add('name');
    else if (/address/i.test(r)) out.add('address');
    else if (/^email domain/i.test(r)) out.add('email');
    else if (/domain matches/i.test(r)) out.add('domain');
    else if (/^phone/i.test(r)) out.add('phone');
  }
  return Array.from(out);
}

/** Confidence pill, color-weighted by strength. */
export function ConfidenceBadge({ confidence, strong }: { confidence: number; strong: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${
        strong ? 'bg-red-600 text-white' : 'bg-slate-200 text-slate-700'
      }`}
      title={strong ? 'Strong match — likely the same vendor' : 'Possible match'}
    >
      {confidence}%
    </span>
  );
}

/** Row of chips naming which signals matched. */
export function SignalChips({ reasons }: { reasons: string[] | null | undefined }) {
  const signals = matchSignals(reasons);
  if (signals.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {signals.map((s) => (
        <span
          key={s}
          className="inline-flex items-center rounded-full border border-current/20 bg-white/60 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-inherit"
        >
          {SIGNAL_LABEL[s]}
        </span>
      ))}
    </span>
  );
}

interface VendorMatchCardProps {
  match: VendorMatchResult;
  /** Strong (>= strongThreshold) matches render red/prominent; hints subtle. */
  strong: boolean;
  /** "Use existing vendor" — select it instead of creating. */
  onUseExisting?: (match: VendorMatchResult) => void;
  /** "Add as a new address/branch of the match" (quick-add only). */
  onAttach?: (match: VendorMatchResult) => void;
  /** vendor_id currently being attached-to (renders that button's spinner). */
  attachingTo?: string | null;
  /** Disable all actions (a save is in flight). */
  disabled?: boolean;
}

export function VendorMatchCard({
  match,
  strong,
  onUseExisting,
  onAttach,
  attachingTo,
  disabled,
}: VendorMatchCardProps) {
  return (
    <div
      className={`rounded-lg border p-2.5 space-y-2 ${
        strong ? 'border-red-300 bg-red-50/70 text-red-900' : 'border-slate-200 bg-slate-50/60 text-slate-700'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <ConfidenceBadge confidence={match.confidence} strong={strong} />
        <span className={`text-sm font-semibold ${strong ? 'text-red-900' : 'text-slate-800'}`}>
          {match.vendor_name}
        </span>
        <SignalChips reasons={match.reasons} />
        <a
          href={`/inventory/vendors/${match.vendor_id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex items-center gap-1 text-xs font-medium underline opacity-80 hover:opacity-100"
          title="Open this vendor's full profile in a new tab"
        >
          View vendor <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      {(match.reasons?.length ?? 0) > 0 && (
        <ul className={`space-y-0.5 text-xs ${strong ? 'text-red-800' : 'text-slate-600'}`}>
          {match.reasons.map((r, i) => (
            <li key={i} className="flex items-start gap-1">
              <span aria-hidden>•</span>
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}
      {(onUseExisting || onAttach) && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {onUseExisting && (
            <button
              type="button"
              onClick={() => onUseExisting(match)}
              disabled={disabled}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                strong
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'bg-slate-700 text-white hover:bg-slate-800'
              }`}
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Use existing vendor
            </button>
          )}
          {onAttach && (
            <button
              type="button"
              onClick={() => onAttach(match)}
              disabled={disabled}
              className="inline-flex items-center gap-1.5 rounded-md border border-current/30 bg-white/70 px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-white disabled:opacity-50"
            >
              {attachingTo === match.vendor_id
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Building2 className="h-3.5 w-3.5" />}
              Add as address/branch
            </button>
          )}
        </div>
      )}
    </div>
  );
}
