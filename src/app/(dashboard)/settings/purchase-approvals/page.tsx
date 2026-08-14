'use client';

/**
 * Purchase approvals — the whole PO approval routing, visible AND configurable
 * (sprint item 10, Grant 2026-08-10; upgraded 2026-08-14 item 02).
 *
 * Grant wanted to SEE "who's approving purchases for whom, and from where"
 * without reading SQL — and then to be able to CHANGE every leg of it. This
 * page renders the real precedence the resolver
 * (supply_chain.resolve_po_approval_route) uses, as a numbered flow:
 *   1. Person overrides — buyer → their personal approver (editable here)
 *   2. Location overrides — location → approver (inline-editable, admin-only)
 *   3. Supervisor routing — buyer → their HR supervisor (read-only mirror, but
 *      each row offers an "Override…" shortcut into tier 1)
 *   4. Fallback — a named list (editable) or the whole admin pool
 * plus the auto-approve caps that decide WHETHER a PO needs sign-off at all,
 * and a "Who approves?" simulator that calls the REAL resolver, so the page can
 * never drift from what actually gates a PO.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  Building2,
  CheckCircle2,
  DollarSign,
  Loader2,
  MapPin,
  Pencil,
  ShieldCheck,
  Sparkles,
  UserCheck,
  UserCog,
  Users,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { getAuthToken, parseJwtPayload } from '@/lib/auth-token';
import { apiWrite } from '@/lib/api-client';
import { SupplyChainRPC } from '@/lib/rpc/supply-chain';

interface Override {
  location_id: string;
  location_name: string;
  last_event_id: string | null;
  approver_user_id: string | null;
  approver_name: string | null;
  approver_title: string | null;
  approver_missing: boolean;
}
interface PersonOverride {
  id: string;
  buyer_user_id: string;
  buyer_name: string;
  buyer_title: string | null;
  approver_user_id: string;
  approver_name: string | null;
  approver_title: string | null;
  approver_missing: boolean;
  note: string | null;
  created_at: string;
}
interface SupervisorRow {
  buyer_user_id: string;
  buyer_name: string;
  buyer_title: string | null;
  is_admin: boolean;
  supervisor_user_id: string | null;
  supervisor_name: string | null;
  supervisor_title: string | null;
  falls_through_to_admins: boolean;
}
interface Admin {
  user_id: string;
  name: string;
  title: string | null;
}
interface FallbackApprover {
  user_id: string;
  name: string;
  title: string | null;
  missing: boolean;
}
interface FlowSettings {
  auto_approve_enabled: boolean;
  auto_approve_limit: number | null;
  vendor_limit_count: number;
}
interface FlowData {
  person_overrides: PersonOverride[];
  fallback_approvers: FallbackApprover[];
  settings: FlowSettings;
  overrides: Override[];
  supervisor_routing: SupervisorRow[];
  admins: Admin[];
  pending_count: number;
  buyers: { user_id: string; name: string; title: string | null }[];
  locations: { id: string; name: string }[];
}
type SimRule = 'person_override' | 'location_override' | 'supervisor' | 'named_fallback' | 'admin_pool';
interface SimStep {
  rule: string;
  outcome: 'matched' | 'none' | 'skipped' | 'unresolved';
  user_id: string | null;
  detail: string;
}
interface SimResult {
  approver_user_id: string | null;
  approver_name: string | null;
  rule: SimRule;
  explanation: string;
  buyer_name: string;
  location_name: string | null;
  steps?: SimStep[];
}

const titleLine = (name: string, title: string | null) =>
  title ? `${name} · ${title}` : name;

const TIER_LABEL: Record<string, string> = {
  person_override: 'Personal override',
  location_override: 'Location approver',
  supervisor: 'Supervisor',
  named_fallback: 'Named fallback approver',
  admin_pool: 'Admin pool (any admin)',
};

const fmtMoney = (n: number | null) =>
  n == null ? '—' : n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export default function PurchaseApprovalsPage() {
  const [data, setData] = useState<FlowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  // Person-override editor state (tier 1).
  const personCardRef = useRef<HTMLDivElement | null>(null);
  const [ovBuyer, setOvBuyer] = useState('');
  const [ovApprover, setOvApprover] = useState('');
  const [ovNote, setOvNote] = useState('');
  const [ovFilter, setOvFilter] = useState('');
  const [ovSaving, setOvSaving] = useState(false);
  const [ovErr, setOvErr] = useState('');
  const [ovFlash, setOvFlash] = useState(false);

  // Inline location-override editor state (tier 2).
  const [editingLoc, setEditingLoc] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [savingLoc, setSavingLoc] = useState(false);
  const [editErr, setEditErr] = useState('');

  // Fallback editor state (tier 4).
  const [fbEditing, setFbEditing] = useState(false);
  const [fbSelected, setFbSelected] = useState<string[]>([]);
  const [fbSaving, setFbSaving] = useState(false);
  const [fbErr, setFbErr] = useState('');

  // Auto-approve quick edit.
  const [aaEditing, setAaEditing] = useState(false);
  const [aaEnabled, setAaEnabled] = useState(true);
  const [aaLimit, setAaLimit] = useState('');
  const [aaSaving, setAaSaving] = useState(false);
  const [aaErr, setAaErr] = useState('');

  // Simulator state.
  const [simBuyer, setSimBuyer] = useState('');
  const [simLocation, setSimLocation] = useState('');
  const [simResult, setSimResult] = useState<SimResult | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simErr, setSimErr] = useState('');

  useEffect(() => {
    // Await the token instead of reading the sync cache — on a hard reload the
    // cache warms asynchronously and a sync read loses the race, leaving admins
    // stuck in read-only mode.
    let alive = true;
    (async () => {
      const token = await getAuthToken();
      const payload = token ? parseJwtPayload(token) : null;
      if (alive) setIsAdmin(payload?.app_metadata?.role === 'admin');
    })();
    return () => {
      alive = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/inventory/purchasing/approval-flow', { credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || `Request failed (${res.status})`);
      setData(json.data as FlowData);
    } catch (e: any) {
      setError(e?.message || 'Failed to load the approval flow.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ── Tier 1: person overrides ─────────────────────────────────────────────
  const savePersonOverride = async () => {
    if (!ovBuyer || !ovApprover) return;
    setOvSaving(true);
    setOvErr('');
    try {
      const res = await apiWrite('/api/inventory/purchasing/approver-overrides', {
        method: 'POST',
        idempotencyKey: crypto.randomUUID(),
        body: {
          buyer_user_id: ovBuyer,
          approver_user_id: ovApprover,
          note: ovNote.trim() || null,
          active: true,
        },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || `Save failed (${res.status})`);
      setOvBuyer('');
      setOvApprover('');
      setOvNote('');
      await load();
    } catch (e: any) {
      setOvErr(e?.message || 'Could not save the override.');
    } finally {
      setOvSaving(false);
    }
  };

  const deactivatePersonOverride = async (o: PersonOverride) => {
    setOvSaving(true);
    setOvErr('');
    try {
      const res = await apiWrite('/api/inventory/purchasing/approver-overrides', {
        method: 'POST',
        idempotencyKey: crypto.randomUUID(),
        body: { buyer_user_id: o.buyer_user_id, active: false },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || `Remove failed (${res.status})`);
      await load();
    } catch (e: any) {
      setOvErr(e?.message || 'Could not remove the override.');
    } finally {
      setOvSaving(false);
    }
  };

  // "Override for this person…" shortcut from the supervisor table.
  const prefillOverrideFor = (buyerUserId: string) => {
    setOvBuyer(buyerUserId);
    setOvFilter('');
    personCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setOvFlash(true);
    window.setTimeout(() => setOvFlash(false), 1600);
  };

  // ── Tier 2: location overrides (unchanged mechanics) ─────────────────────
  const startEdit = (o: Override) => {
    setEditingLoc(o.location_id);
    setEditValue(o.approver_user_id || '');
    setEditErr('');
  };

  const saveOverride = async (o: Override) => {
    setSavingLoc(true);
    setEditErr('');
    try {
      const res = await apiWrite(`/api/inventory/locations/${o.location_id}/po-approver`, {
        method: 'PATCH',
        idempotencyKey: `po-approver-${o.location_id}-${o.last_event_id}`,
        body: {
          po_approver_user_id: editValue || null,
          expected_last_event_id: o.last_event_id,
        },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || `Save failed (${res.status})`);
      setEditingLoc(null);
      await load();
    } catch (e: any) {
      setEditErr(e?.message || 'Could not save. Try again.');
    } finally {
      setSavingLoc(false);
    }
  };

  // ── Tier 4: named fallback list ──────────────────────────────────────────
  const startFbEdit = () => {
    setFbSelected((data?.fallback_approvers ?? []).map((f) => f.user_id));
    setFbErr('');
    setFbEditing(true);
  };

  const saveFallback = async (ids: string[]) => {
    setFbSaving(true);
    setFbErr('');
    try {
      await SupplyChainRPC.updateTenantSettings({ po_fallback_approver_user_ids: ids } as any);
      setFbEditing(false);
      await load();
    } catch (e: any) {
      setFbErr(e?.message || 'Could not save fallback approvers.');
    } finally {
      setFbSaving(false);
    }
  };

  // ── Auto-approve quick edit ──────────────────────────────────────────────
  const startAaEdit = () => {
    setAaEnabled(data?.settings.auto_approve_enabled ?? true);
    setAaLimit(data?.settings.auto_approve_limit != null ? String(data.settings.auto_approve_limit) : '');
    setAaErr('');
    setAaEditing(true);
  };

  const saveAutoApprove = async () => {
    setAaSaving(true);
    setAaErr('');
    try {
      const updates: Record<string, unknown> = { auto_approve_enabled: aaEnabled };
      if (aaLimit.trim() !== '') {
        const n = parseFloat(aaLimit);
        if (Number.isNaN(n) || n < 0) throw new Error('Limit must be a positive number.');
        updates.auto_approve_limit = n;
      }
      await SupplyChainRPC.updateTenantSettings(updates as any);
      setAaEditing(false);
      await load();
    } catch (e: any) {
      setAaErr(e?.message || 'Could not save auto-approve settings.');
    } finally {
      setAaSaving(false);
    }
  };

  // ── Simulator ────────────────────────────────────────────────────────────
  const runSimulation = async () => {
    if (!simBuyer) return;
    setSimLoading(true);
    setSimErr('');
    setSimResult(null);
    try {
      const qs = new URLSearchParams({ buyer_user_id: simBuyer });
      if (simLocation) qs.set('delivery_location_id', simLocation);
      const res = await fetch(`/api/inventory/purchasing/approval-flow/simulate?${qs.toString()}`, {
        credentials: 'include',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || `Request failed (${res.status})`);
      setSimResult(json.data as SimResult);
    } catch (e: any) {
      setSimErr(e?.message || 'Simulation failed.');
    } finally {
      setSimLoading(false);
    }
  };

  const activeOverrides = (data?.overrides ?? []).filter((o) => o.approver_user_id);
  const totalLocations = data?.overrides?.length ?? 0;
  const nonAdminBuyers = (data?.supervisor_routing ?? []).filter((r) => !r.is_admin);
  const noSupervisor = (data?.supervisor_routing ?? []).filter(
    (r) => r.falls_through_to_admins && !r.is_admin,
  );
  const withSupervisor = nonAdminBuyers.length - noSupervisor.length;
  const personOverrides = data?.person_overrides ?? [];
  const fallbackApprovers = data?.fallback_approvers ?? [];
  const usesNamedFallback = fallbackApprovers.length > 0;

  const filteredBuyers = (data?.buyers ?? []).filter(
    (b) => !ovFilter || b.name.toLowerCase().includes(ovFilter.toLowerCase()),
  );

  return (
    <AppShell>
      <PageHeader
        title="Purchase approvals"
        description="Who approves purchases, for whom, and from where — the real routing, visible and configurable."
      />

      {/* Context strip */}
      <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
        <p className="text-sm text-blue-900">
          When a purchase order goes over the buyer&apos;s spend limit or budget, it needs sign-off.
          Approvers act from the{' '}
          <a href="/inventory/purchasing/approvals" className="font-medium underline">
            Approvals page
          </a>{' '}
          or <strong>My Day on their phone</strong>.
          {data ? (
            <>
              {' '}
              <span className="font-semibold">{data.pending_count}</span> purchase order
              {data.pending_count === 1 ? '' : 's'} awaiting approval right now.
            </>
          ) : null}
        </p>
      </div>

      {/* How routing works — every tier, in order, each linking to its card. */}
      <div className="mb-6 rounded-lg border bg-white p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
          How routing works — first match wins
        </p>
        <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-2 text-sm">
          {[
            { href: '#step-person', num: 1, label: 'Personal override', desc: 'this buyer has a named approver' },
            { href: '#step-location', num: 2, label: 'Location approver', desc: 'the delivery yard has one' },
            { href: '#step-supervisor', num: 3, label: 'Supervisor', desc: 'the buyer’s boss (from HR)' },
            {
              href: '#step-fallback',
              num: 4,
              label: usesNamedFallback ? 'Named fallback' : 'Any admin',
              desc: usesNamedFallback ? 'your chosen fallback people' : 'the admin pool',
            },
          ].map((t, i) => (
            <li key={t.num} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-gray-300">→</span>}
              <a
                href={t.href}
                className="group inline-flex items-center gap-1.5 rounded-full border px-3 py-1 hover:border-primary hover:bg-primary/5"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                  {t.num}
                </span>
                <span className="font-medium">{t.label}</span>
                <span className="hidden text-xs text-gray-500 sm:inline">— {t.desc}</span>
              </a>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-gray-500">
          Whether a PO needs sign-off at all is decided by the{' '}
          <a href="#auto-approve" className="font-medium underline">
            auto-approve caps
          </a>{' '}
          below. Buyers never approve their own purchases — any tier that lands on the buyer is skipped.
        </p>
      </div>

      {/* Config health: a yard with no approver + a buyer with no supervisor =
          the PO drops into the anonymous admin pool (the Zach case). */}
      {data && !loading && !error && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2">
          <div
            className={`rounded-lg border p-4 ${
              activeOverrides.length === 0 ? 'border-amber-300 bg-amber-50' : 'border-emerald-200 bg-emerald-50'
            }`}
          >
            <div className="flex items-center gap-2">
              <MapPin className={`h-4 w-4 ${activeOverrides.length === 0 ? 'text-amber-600' : 'text-emerald-600'}`} />
              <span className="text-sm font-semibold text-gray-900">Location approvers</span>
            </div>
            <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">
              {activeOverrides.length}
              <span className="text-base font-medium text-gray-500"> / {totalLocations} set</span>
            </p>
            <p className="mt-1 text-xs text-gray-600">
              {activeOverrides.length === 0
                ? 'No location has a named approver — every purchase falls to the default path below. Set one on a yard to route its purchases to a real person.'
                : `${totalLocations - activeOverrides.length} location${totalLocations - activeOverrides.length === 1 ? '' : 's'} still route via the default path.`}
            </p>
          </div>

          <div
            className={`rounded-lg border p-4 ${
              noSupervisor.length > 0 ? 'border-amber-300 bg-amber-50' : 'border-emerald-200 bg-emerald-50'
            }`}
          >
            <div className="flex items-center gap-2">
              <UserCog className={`h-4 w-4 ${noSupervisor.length > 0 ? 'text-amber-600' : 'text-emerald-600'}`} />
              <span className="text-sm font-semibold text-gray-900">Supervisor coverage</span>
            </div>
            <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">
              {withSupervisor}
              <span className="text-base font-medium text-gray-500"> / {nonAdminBuyers.length} covered</span>
            </p>
            <p className="mt-1 text-xs text-gray-600">
              {noSupervisor.length > 0 ? (
                <>
                  <span className="font-semibold text-amber-800">{noSupervisor.length}</span> non-admin buyer
                  {noSupervisor.length === 1 ? '' : 's'} have no supervisor on file — their over-limit purchases
                  fall to the fallback tier. Supervisors are set in the HR app; a personal override here also fixes it.
                </>
              ) : (
                'Every non-admin buyer has a supervisor — the default path always resolves to a person.'
              )}
            </p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-16 text-gray-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading the approval flow…
        </div>
      ) : error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
      ) : data ? (
        <div className="max-w-4xl space-y-4">
          {/* ── Step 1: Person overrides ───────────────────────────────── */}
          <div id="step-person" ref={personCardRef} className="scroll-mt-4">
            <FlowStep
              num={1}
              icon={<UserCheck className="h-5 w-5" />}
              title="Person overrides"
              subtitle="Whenever THIS buyer needs sign-off, route to THAT approver — beats every other rule."
            >
              {personOverrides.length === 0 ? (
                <p className="mb-3 text-sm text-gray-400">
                  No personal overrides set — buyers route by location and supervisor below.
                </p>
              ) : (
                <div className="mb-3 space-y-2">
                  {personOverrides.map((o) => (
                    <div
                      key={o.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-white px-3 py-2"
                    >
                      <div className="min-w-0 text-sm">
                        <span className="font-medium">{titleLine(o.buyer_name, o.buyer_title)}</span>
                        <span className="mx-1.5 text-gray-400">→</span>
                        {o.approver_missing ? (
                          <span className="text-amber-700">approver no longer a user — fix this</span>
                        ) : (
                          <span className="font-medium">
                            {titleLine(o.approver_name || 'Unknown', o.approver_title)}
                          </span>
                        )}
                        {o.note ? <span className="ml-2 text-xs text-gray-500">“{o.note}”</span> : null}
                      </div>
                      {isAdmin && (
                        <button
                          onClick={() => deactivatePersonOverride(o)}
                          disabled={ovSaving}
                          className="rounded-md border px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {isAdmin ? (
                <div
                  className={`rounded-md border bg-white p-3 transition-shadow ${
                    ovFlash ? 'ring-2 ring-primary' : ''
                  }`}
                >
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                    Add / replace an override
                  </p>
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600">Find buyer</label>
                      <input
                        type="text"
                        value={ovFilter}
                        onChange={(e) => setOvFilter(e.target.value)}
                        placeholder="Type a name…"
                        className="w-36 rounded-md border px-2 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600">Buyer</label>
                      <select
                        value={ovBuyer}
                        onChange={(e) => setOvBuyer(e.target.value)}
                        className="max-w-[14rem] rounded-md border px-2 py-1.5 text-sm"
                        disabled={ovSaving}
                      >
                        <option value="">Select buyer…</option>
                        {filteredBuyers.map((b) => (
                          <option key={b.user_id} value={b.user_id}>
                            {titleLine(b.name, b.title)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600">Routes to</label>
                      <select
                        value={ovApprover}
                        onChange={(e) => setOvApprover(e.target.value)}
                        className="max-w-[14rem] rounded-md border px-2 py-1.5 text-sm"
                        disabled={ovSaving}
                      >
                        <option value="">Select approver…</option>
                        {(data.buyers ?? [])
                          .filter((b) => b.user_id !== ovBuyer)
                          .map((b) => (
                            <option key={b.user_id} value={b.user_id}>
                              {titleLine(b.name, b.title)}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className="grow">
                      <label className="mb-1 block text-xs font-medium text-gray-600">
                        Note <span className="text-gray-400">(optional — why)</span>
                      </label>
                      <input
                        type="text"
                        value={ovNote}
                        onChange={(e) => setOvNote(e.target.value)}
                        placeholder="e.g. covering while Sarah is out"
                        className="w-full min-w-[10rem] rounded-md border px-2 py-1.5 text-sm"
                        disabled={ovSaving}
                      />
                    </div>
                    <button
                      onClick={savePersonOverride}
                      disabled={!ovBuyer || !ovApprover || ovSaving}
                      className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
                    >
                      {ovSaving ? 'Saving…' : 'Save override'}
                    </button>
                  </div>
                  {ovErr && <p className="mt-2 text-sm text-red-700">{ovErr}</p>}
                </div>
              ) : (
                <p className="text-xs text-gray-500">Read-only — an admin can set or remove these.</p>
              )}
            </FlowStep>
          </div>

          <FlowArrow label="if no personal override…" />

          {/* ── Step 2: Location overrides ─────────────────────────────── */}
          <div id="step-location" className="scroll-mt-4">
            <FlowStep
              num={2}
              icon={<MapPin className="h-5 w-5" />}
              title="Location overrides"
              subtitle="If the delivery location has its own approver, they approve — no matter who bought."
            >
              {!isAdmin && (
                <p className="mb-3 text-xs text-gray-500">
                  Read-only — an admin can set or clear these.
                </p>
              )}
              <div className="space-y-2">
                {data.overrides.map((o) => (
                  <div
                    key={o.location_id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-white px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-gray-400" />
                      <span className="text-sm font-medium">{o.location_name}</span>
                    </div>

                    {editingLoc === o.location_id ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="rounded-md border px-2 py-1 text-sm"
                          disabled={savingLoc}
                        >
                          <option value="">— No override (use default path) —</option>
                          {data.buyers.map((b) => (
                            <option key={b.user_id} value={b.user_id}>
                              {titleLine(b.name, b.title)}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => saveOverride(o)}
                          disabled={savingLoc}
                          className="rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
                        >
                          {savingLoc ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          onClick={() => setEditingLoc(null)}
                          disabled={savingLoc}
                          className="rounded-md border px-3 py-1 text-sm"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        {o.approver_user_id ? (
                          <span className="text-sm">
                            <span className="mr-1 text-gray-400">approver:</span>
                            {o.approver_missing ? (
                              <span className="text-amber-700">approver no longer a user — fix this</span>
                            ) : (
                              <span className="font-medium">
                                {titleLine(o.approver_name || 'Unknown', o.approver_title)}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-sm text-gray-400">No override — uses the default path</span>
                        )}
                        {isAdmin && (
                          <button
                            onClick={() => startEdit(o)}
                            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                          >
                            <Pencil className="h-3 w-3" /> Edit
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {editErr && <p className="mt-2 text-sm text-red-700">{editErr}</p>}
              <p className="mt-3 text-xs text-gray-500">
                {activeOverrides.length === 0
                  ? 'No location overrides set — every purchase currently follows the default supervisor path below.'
                  : `${activeOverrides.length} location${activeOverrides.length === 1 ? '' : 's'} route to a set approver.`}
              </p>
            </FlowStep>
          </div>

          <FlowArrow label="if no location override…" />

          {/* ── Step 3: Supervisor routing ─────────────────────────────── */}
          <div id="step-supervisor" className="scroll-mt-4">
            <FlowStep
              num={3}
              icon={<UserCog className="h-5 w-5" />}
              title="Supervisor routing (the default path)"
              subtitle="Otherwise a buyer's over-limit purchase routes to their supervisor. Mirrored from HR — change it there, or set a personal override here."
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[32rem] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-gray-500">
                      <th className="py-2 pr-4 font-medium">Buyer</th>
                      <th className="py-2 pr-4 font-medium">Approves via</th>
                      {isAdmin ? <th className="py-2 pr-0 font-medium" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {data.supervisor_routing.map((r) => {
                      const hasPersonOverride = personOverrides.some(
                        (o) => o.buyer_user_id === r.buyer_user_id,
                      );
                      return (
                        <tr key={r.buyer_user_id} className="border-b last:border-0">
                          <td className="py-2 pr-4">
                            <span className="font-medium">{r.buyer_name}</span>
                            {r.buyer_title ? <span className="text-gray-500"> · {r.buyer_title}</span> : null}
                            {r.is_admin ? (
                              <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">
                                admin
                              </span>
                            ) : null}
                            {hasPersonOverride ? (
                              <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                                overridden above
                              </span>
                            ) : null}
                          </td>
                          <td className="py-2 pr-4">
                            {r.supervisor_user_id ? (
                              <span>{titleLine(r.supervisor_name || 'Unknown', r.supervisor_title)}</span>
                            ) : (
                              <span className="text-amber-700">
                                No supervisor → falls to the fallback tier
                              </span>
                            )}
                          </td>
                          {isAdmin ? (
                            <td className="py-2 pr-0 text-right">
                              <button
                                onClick={() => prefillOverrideFor(r.buyer_user_id)}
                                className="whitespace-nowrap rounded-md border px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                              >
                                Override for this person…
                              </button>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {noSupervisor.length > 0 && (
                <p className="mt-3 text-xs text-amber-700">
                  {noSupervisor.length} non-admin{noSupervisor.length === 1 ? ' has' : 's have'} no
                  supervisor on file — their over-limit purchases fall through to the fallback tier below.
                  Supervisors are set in the HR app; a personal override (step 1) fixes it from here.
                </p>
              )}
            </FlowStep>
          </div>

          <FlowArrow label="if no supervisor resolves…" />

          {/* ── Step 4: Fallback ───────────────────────────────────────── */}
          <div id="step-fallback" className="scroll-mt-4">
            <FlowStep
              num={4}
              icon={<ShieldCheck className="h-5 w-5" />}
              title={usesNamedFallback ? 'Fallback — named approvers' : 'Fallback — any admin'}
              subtitle={
                usesNamedFallback
                  ? 'When nothing above resolves, the first eligible person on this list gets it — a real inbox, not the anonymous pool.'
                  : 'When nothing above resolves, any admin can approve. Name specific people so these always land in a real inbox.'
              }
            >
              {fbEditing && isAdmin ? (
                <div className="rounded-md border bg-white p-3">
                  <p className="mb-2 text-xs text-gray-600">
                    Pick the people who catch unrouted purchases, in order of preference. Clear everyone
                    to go back to “any admin”.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {data.admins.map((a) => {
                      const checked = fbSelected.includes(a.user_id);
                      return (
                        <label
                          key={a.user_id}
                          className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${
                            checked ? 'border-primary bg-primary/10' : 'bg-white'
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5"
                            checked={checked}
                            onChange={(e) =>
                              setFbSelected((prev) =>
                                e.target.checked
                                  ? [...prev, a.user_id]
                                  : prev.filter((id) => id !== a.user_id),
                              )
                            }
                            disabled={fbSaving}
                          />
                          {titleLine(a.name, a.title)}
                        </label>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={() => saveFallback(fbSelected)}
                      disabled={fbSaving}
                      className="rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
                    >
                      {fbSaving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      onClick={() => setFbEditing(false)}
                      disabled={fbSaving}
                      className="rounded-md border px-3 py-1 text-sm"
                    >
                      Cancel
                    </button>
                    {fbSelected.length === 0 && (
                      <span className="text-xs text-gray-500">Empty list = any admin (today&apos;s default).</span>
                    )}
                  </div>
                  {fbErr && <p className="mt-2 text-sm text-red-700">{fbErr}</p>}
                </div>
              ) : (
                <>
                  {usesNamedFallback ? (
                    <div className="flex flex-wrap gap-2">
                      {fallbackApprovers.map((f, i) => (
                        <span
                          key={f.user_id}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${
                            f.missing ? 'border-amber-300 bg-amber-50 text-amber-800' : 'bg-white'
                          }`}
                        >
                          <span className="text-xs font-semibold text-gray-400">#{i + 1}</span>
                          {titleLine(f.name, f.title)}
                        </span>
                      ))}
                    </div>
                  ) : data.admins.length === 0 ? (
                    <p className="text-sm text-amber-700">
                      No admins found — purchases that reach this step would have nobody to approve them.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {data.admins.map((a) => (
                        <span
                          key={a.user_id}
                          className="inline-flex items-center gap-1.5 rounded-full border bg-white px-3 py-1 text-sm"
                        >
                          <Users className="h-3.5 w-3.5 text-gray-400" />
                          {titleLine(a.name, a.title)}
                        </span>
                      ))}
                    </div>
                  )}
                  {isAdmin && (
                    <button
                      onClick={startFbEdit}
                      className="mt-3 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                    >
                      <Pencil className="h-3 w-3" />
                      {usesNamedFallback ? 'Edit fallback approvers' : 'Name specific fallback approvers'}
                    </button>
                  )}
                  {!usesNamedFallback && (
                    <p className="mt-2 text-xs text-gray-500">
                      Purchases landing here sit in the anonymous admin pool — any admin can approve,
                      nobody in particular is asked.
                    </p>
                  )}
                </>
              )}
            </FlowStep>
          </div>

          {/* ── Auto-approve caps ──────────────────────────────────────── */}
          <div id="auto-approve" className="scroll-mt-4">
            <div className="rounded-lg border bg-white p-5">
              <h3 className="flex items-center gap-2 text-base font-semibold">
                <DollarSign className="h-5 w-5 text-gray-500" />
                Auto-approve caps — when is sign-off needed at all?
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                Purchases at or under the buyer&apos;s effective limit approve themselves; anything over
                (or any purchase when auto-approve is off) routes through the tiers above.
              </p>
              {aaEditing && isAdmin ? (
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={aaEnabled}
                      onChange={(e) => setAaEnabled(e.target.checked)}
                      disabled={aaSaving}
                      className="h-4 w-4"
                    />
                    Auto-approve enabled
                  </label>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">Default limit ($)</label>
                    <input
                      type="number"
                      min="0"
                      value={aaLimit}
                      onChange={(e) => setAaLimit(e.target.value)}
                      className="w-32 rounded-md border px-2 py-1.5 text-sm"
                      disabled={aaSaving}
                    />
                  </div>
                  <button
                    onClick={saveAutoApprove}
                    disabled={aaSaving}
                    className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
                  >
                    {aaSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={() => setAaEditing(false)}
                    disabled={aaSaving}
                    className="rounded-md border px-3 py-1.5 text-sm"
                  >
                    Cancel
                  </button>
                  {aaErr && <p className="w-full text-sm text-red-700">{aaErr}</p>}
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
                  <span
                    className={`rounded-full px-3 py-1 font-medium ${
                      data.settings.auto_approve_enabled
                        ? 'bg-emerald-50 text-emerald-800'
                        : 'bg-amber-50 text-amber-800'
                    }`}
                  >
                    {data.settings.auto_approve_enabled ? 'Auto-approve ON' : 'Auto-approve OFF — everything needs sign-off'}
                  </span>
                  <span>
                    Default limit: <strong>{fmtMoney(data.settings.auto_approve_limit)}</strong>
                  </span>
                  <span>
                    Per-vendor limits: <strong>{data.settings.vendor_limit_count}</strong> set
                  </span>
                  {isAdmin && (
                    <button
                      onClick={startAaEdit}
                      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                    >
                      <Pencil className="h-3 w-3" /> Quick edit
                    </button>
                  )}
                </div>
              )}
              <p className="mt-2 text-xs text-gray-500">
                Per-vendor limits, position limits, and personal budgets live in{' '}
                <a href="/settings" className="font-medium underline">
                  Purchasing settings
                </a>{' '}
                and{' '}
                <a href="/settings/people" className="font-medium underline">
                  People settings
                </a>
                .
              </p>
            </div>
          </div>

          {/* ── Simulator ──────────────────────────────────────────────── */}
          <div id="simulator" className="mt-8 rounded-lg border bg-white p-5">
            <h3 className="flex items-center gap-2 border-b pb-3 text-lg font-semibold">
              <Sparkles className="h-5 w-5 text-teal-600" />
              Who approves?
            </h3>
            <p className="mt-3 text-sm text-gray-600">
              Pick a buyer and a delivery location to see who would approve their over-limit purchase.
              This runs the real routing rule, so the answer always matches what actually happens.
            </p>
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Buyer</label>
                <select
                  value={simBuyer}
                  onChange={(e) => setSimBuyer(e.target.value)}
                  className="rounded-md border px-3 py-2 text-sm"
                >
                  <option value="">Select a buyer…</option>
                  {data.buyers.map((b) => (
                    <option key={b.user_id} value={b.user_id}>
                      {titleLine(b.name, b.title)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Delivery location <span className="text-gray-400">(optional)</span>
                </label>
                <select
                  value={simLocation}
                  onChange={(e) => setSimLocation(e.target.value)}
                  className="rounded-md border px-3 py-2 text-sm"
                >
                  <option value="">Any / no specific location</option>
                  {data.locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={runSimulation}
                disabled={!simBuyer || simLoading}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
              >
                {simLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Who approves?
              </button>
            </div>

            {simErr && <p className="mt-3 text-sm text-red-700">{simErr}</p>}
            {simResult && (
              <div className="mt-4 rounded-md border border-teal-200 bg-teal-50 p-4">
                <p className="text-sm text-teal-900">
                  {simResult.rule === 'admin_pool' ? (
                    <>
                      <span className="font-semibold">{simResult.buyer_name}</span>&apos;s over-limit
                      purchase{simResult.location_name ? ` to ${simResult.location_name}` : ''} would be
                      approved by <span className="font-semibold">any admin</span>.
                    </>
                  ) : (
                    <>
                      <span className="font-semibold">{simResult.buyer_name}</span>&apos;s over-limit
                      purchase{simResult.location_name ? ` to ${simResult.location_name}` : ''} routes to{' '}
                      <span className="font-semibold">{simResult.approver_name}</span>.
                    </>
                  )}
                </p>
                <p className="mt-1 text-xs font-medium uppercase tracking-wide text-teal-700">
                  Matched: {TIER_LABEL[simResult.rule] || simResult.rule} — {simResult.explanation}
                </p>
                {simResult.steps && simResult.steps.length > 0 && (
                  <ol className="mt-2 space-y-1 border-t border-teal-200 pt-2">
                    {simResult.steps.map((s, i) => {
                      const matched = s.outcome === 'matched';
                      return (
                        <li key={i} className="flex items-start gap-1.5 text-[11px]">
                          <span
                            className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                              matched
                                ? s.rule === 'admin_pool'
                                  ? 'bg-amber-500'
                                  : 'bg-emerald-500'
                                : 'bg-teal-300'
                            }`}
                          />
                          <span className={matched ? 'font-medium text-teal-900' : 'text-teal-700'}>
                            {TIER_LABEL[s.rule] || s.rule}: {s.detail}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}

function FlowStep({
  num,
  icon,
  title,
  subtitle,
  children,
}: {
  num: number;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-gray-50/60 p-5">
      <div className="mb-3 flex items-start gap-3">
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
          {num}
        </span>
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <span className="text-gray-500">{icon}</span>
            {title}
          </h3>
          <p className="text-sm text-gray-500">{subtitle}</p>
        </div>
      </div>
      <div className="pl-11">{children}</div>
    </div>
  );
}

function FlowArrow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 pl-4 text-xs text-gray-400">
      <ArrowDown className="h-4 w-4" />
      <span>{label}</span>
    </div>
  );
}
