'use client';

/**
 * The PO approval trail, made visible (sprint item 14, Grant 2026-08-12).
 *
 * The Zach case: a PO routed to the anonymous admin pool and got approved
 * silently — nobody could see WHO it went to or WHY. This renders the whole
 * routing story as a compact pipeline:
 *
 *   Requested by [buyer] → routed to [approver | ⚠ admin pool] → [decision]
 *
 * The ⚠ "admin pool" state is deliberately loud (amber, warning icon) — that
 * anonymous pool IS the ether this item exists to kill. When an approval_route
 * trace is present (stored at submit by resolve_po_approval_route), the "why"
 * expands into the three rule steps the resolver walked.
 *
 * Pure presentational — every field is passed in; it fetches nothing.
 */

import { AlertTriangle, ArrowRight, CheckCircle2, Clock, ShieldQuestion, User, XCircle } from 'lucide-react';

export interface ApprovalRouteStep {
  rule: 'location_override' | 'supervisor' | 'admin_pool';
  outcome: 'matched' | 'none' | 'skipped' | 'unresolved';
  user_id: string | null;
  detail: string;
}
export interface ApprovalRoute {
  resolved_rule?: 'location_override' | 'supervisor' | 'admin_pool';
  resolved_user_id?: string | null;
  buyer_user_id?: string | null;
  delivery_location_id?: string | null;
  steps?: ApprovalRouteStep[];
  resolved_at?: string;
}

export interface POApprovalTrailProps {
  buyerName: string;
  buyerIsMachine?: boolean;
  /** Named approver, or null when the PO sits in the anonymous admin pool. */
  approverName?: string | null;
  isPool?: boolean;
  /** 'pending' while awaiting a decision; else the decision outcome. */
  decision?: 'pending' | 'approved' | 'denied';
  decidedBy?: string | null;
  decidedAt?: string | null;
  /** The approver's / rejecter's own words. */
  decisionReason?: string | null;
  /** Why it needed approval in the first place (over limit / AI restock). */
  needReason?: string | null;
  route?: ApprovalRoute | null;
  /** Compact = one line, no expanded rule steps (inbox rows). */
  compact?: boolean;
}

const RULE_LABEL: Record<string, string> = {
  location_override: 'Location approver',
  supervisor: 'Supervisor',
  admin_pool: 'Admin pool',
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function Node({
  tone,
  icon,
  label,
  sub,
}: {
  tone: 'neutral' | 'warn' | 'ok' | 'bad';
  icon: React.ReactNode;
  label: React.ReactNode;
  sub?: React.ReactNode;
}) {
  const toneCls =
    tone === 'warn'
      ? 'border-amber-300 bg-amber-50 text-amber-900'
      : tone === 'ok'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
        : tone === 'bad'
          ? 'border-red-200 bg-red-50 text-red-900'
          : 'border-gray-200 bg-gray-50 text-gray-800';
  return (
    <div className={`min-w-0 rounded-lg border px-2.5 py-1.5 ${toneCls}`}>
      <div className="flex items-center gap-1.5">
        <span className="shrink-0">{icon}</span>
        <span className="truncate text-xs font-semibold">{label}</span>
      </div>
      {sub ? <div className="mt-0.5 truncate text-[11px] opacity-80">{sub}</div> : null}
    </div>
  );
}

export function POApprovalTrail(props: POApprovalTrailProps) {
  const {
    buyerName,
    buyerIsMachine,
    approverName,
    isPool,
    decision = 'pending',
    decidedBy,
    decidedAt,
    decisionReason,
    needReason,
    route,
    compact,
  } = props;

  return (
    <div className="space-y-2">
      {/* The pipeline: requested → routed → decision */}
      <div className="flex items-stretch gap-1.5 overflow-x-auto">
        <Node
          tone="neutral"
          icon={<User className="h-3.5 w-3.5" />}
          label={buyerIsMachine ? 'Nightly auto-reorder' : buyerName}
          sub="Requested"
        />
        <div className="flex items-center text-gray-300">
          <ArrowRight className="h-4 w-4" />
        </div>
        {isPool ? (
          <Node
            tone="warn"
            icon={<AlertTriangle className="h-3.5 w-3.5" />}
            label="Admin pool — nobody specific"
            sub="Unrouted"
          />
        ) : (
          <Node
            tone="neutral"
            icon={<ShieldQuestion className="h-3.5 w-3.5" />}
            label={approverName || 'Approver'}
            sub="Routed to"
          />
        )}
        <div className="flex items-center text-gray-300">
          <ArrowRight className="h-4 w-4" />
        </div>
        {decision === 'approved' ? (
          <Node
            tone="ok"
            icon={<CheckCircle2 className="h-3.5 w-3.5" />}
            label={decidedBy || 'Approved'}
            sub={decidedAt ? `Approved ${fmtDate(decidedAt)}` : 'Approved'}
          />
        ) : decision === 'denied' ? (
          <Node
            tone="bad"
            icon={<XCircle className="h-3.5 w-3.5" />}
            label={decidedBy || 'Denied'}
            sub={decidedAt ? `Denied ${fmtDate(decidedAt)}` : 'Denied'}
          />
        ) : (
          <Node
            tone="neutral"
            icon={<Clock className="h-3.5 w-3.5" />}
            label="Awaiting sign-off"
            sub="Pending"
          />
        )}
      </div>

      {/* Loud unrouted hint — the whole point of item 14. */}
      {isPool && decision === 'pending' && (
        <div className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Unrouted — no location approver or supervisor resolved, so this fell to the admin pool.{' '}
            <a href="/settings/purchase-approvals" className="font-semibold underline">
              Configure approvers
            </a>{' '}
            so purchases reach a named person.
          </span>
        </div>
      )}

      {/* Why it needed approval (the AI-restock label / over-limit reason). */}
      {needReason && (
        <p className="rounded-md bg-gray-50 px-2 py-1 text-[11px] text-gray-600">
          <span className="font-medium">Needs approval:</span> {needReason}
        </p>
      )}

      {/* The approver's / rejecter's own words. */}
      {decisionReason && (
        <p
          className={`rounded-md px-2 py-1 text-[11px] ${
            decision === 'denied' ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'
          }`}
        >
          <span className="font-medium">{decision === 'denied' ? 'Denied' : 'Approved'} because:</span>{' '}
          {decisionReason}
        </p>
      )}

      {/* Expanded rule steps — why routing landed where it did. */}
      {!compact && route?.steps && route.steps.length > 0 && (
        <div className="rounded-md border bg-white p-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">How it routed</p>
          <ol className="space-y-1">
            {route.steps.map((s, i) => {
              const matched = s.outcome === 'matched';
              return (
                <li key={i} className="flex items-start gap-1.5 text-[11px]">
                  <span
                    className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                      matched ? (s.rule === 'admin_pool' ? 'bg-amber-500' : 'bg-emerald-500') : 'bg-gray-300'
                    }`}
                  />
                  <span className={matched ? 'font-medium text-gray-800' : 'text-gray-500'}>
                    {RULE_LABEL[s.rule] || s.rule}: {s.detail}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
