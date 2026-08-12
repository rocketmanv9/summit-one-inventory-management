'use client';

/**
 * Purchase approvals — the whole PO approval routing, made visible (sprint item
 * 10, Grant 2026-08-10).
 *
 * Grant wanted to SEE "who's approving purchases for whom, and from where"
 * without reading SQL. This page renders the real precedence the resolver
 * (supply_chain.resolve_po_approver) uses, as a numbered flow:
 *   1. Location overrides — location → approver (inline-editable here, admin-only)
 *   2. Supervisor routing — buyer → their HR supervisor (read-only mirror)
 *   3. Fallback — the admin pool, when 1 and 2 resolve nobody
 * plus a "Who approves?" simulator that calls the REAL resolver, so the page can
 * never drift from what actually gates a PO.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ArrowDown,
  Building2,
  CheckCircle2,
  Loader2,
  MapPin,
  Pencil,
  ShieldCheck,
  Sparkles,
  UserCog,
  Users,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { getStoredAccessToken, parseJwtPayload } from '@/lib/auth-token';
import { apiWrite } from '@/lib/api-client';

interface Override {
  location_id: string;
  location_name: string;
  last_event_id: string | null;
  approver_user_id: string | null;
  approver_name: string | null;
  approver_title: string | null;
  approver_missing: boolean;
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
interface Picker {
  user_id?: string;
  id?: string;
  name: string;
  title?: string | null;
}
interface FlowData {
  overrides: Override[];
  supervisor_routing: SupervisorRow[];
  admins: Admin[];
  pending_count: number;
  buyers: { user_id: string; name: string; title: string | null }[];
  locations: { id: string; name: string }[];
}
interface SimResult {
  approver_user_id: string | null;
  approver_name: string | null;
  rule: 'location_override' | 'supervisor' | 'admin_fallback';
  explanation: string;
  buyer_name: string;
  location_name: string | null;
}

const titleLine = (name: string, title: string | null) =>
  title ? `${name} · ${title}` : name;

export default function PurchaseApprovalsPage() {
  const [data, setData] = useState<FlowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  // Inline override editor state.
  const [editingLoc, setEditingLoc] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [savingLoc, setSavingLoc] = useState(false);
  const [editErr, setEditErr] = useState('');

  // Simulator state.
  const [simBuyer, setSimBuyer] = useState('');
  const [simLocation, setSimLocation] = useState('');
  const [simResult, setSimResult] = useState<SimResult | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simErr, setSimErr] = useState('');

  useEffect(() => {
    const token = getStoredAccessToken();
    const payload = token ? parseJwtPayload(token) : null;
    setIsAdmin(payload?.app_metadata?.role === 'admin');
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

  return (
    <AppShell>
      <PageHeader
        title="Purchase approvals"
        description="Who approves purchases, for whom, and from where — the real routing, visible."
      />

      {/* Context strip */}
      <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
        <p className="text-sm text-blue-900">
          When a purchase order goes over the buyer&apos;s spend limit or budget, it needs sign-off.
          We decide who signs off in this order: first a{' '}
          <strong>location&apos;s own approver</strong>, otherwise the buyer&apos;s{' '}
          <strong>supervisor</strong>, and if neither is set, <strong>any admin</strong> can approve.
        </p>
        <p className="mt-2 text-sm text-blue-900">
          Approvers act on these from the{' '}
          <a href="/inventory/purchasing/approvals" className="font-medium underline">
            Approvals page
          </a>
          , or from <strong>My Day on their phone</strong> (approve or deny in-app).
          {data ? (
            <>
              {' '}
              <span className="font-semibold">{data.pending_count}</span> purchase order
              {data.pending_count === 1 ? '' : 's'} awaiting approval right now.
            </>
          ) : null}
        </p>
      </div>

      {/* Config health (item 14): make the routing's real weaknesses loud.
          A yard with no approver + a buyer with no supervisor = the PO drops
          into the anonymous admin pool, which is exactly how the Zach case
          went silent. */}
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
                  fall to the admin pool. Supervisors are set in the HR app.
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
          {/* ── Step 1: Location overrides ─────────────────────────────── */}
          <FlowStep
            num={1}
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
                          <ArrowDownRightLabel />
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

          <FlowArrow label="if no location override…" />

          {/* ── Step 2: Supervisor routing ─────────────────────────────── */}
          <FlowStep
            num={2}
            icon={<UserCog className="h-5 w-5" />}
            title="Supervisor routing (the default path)"
            subtitle="Otherwise a buyer's over-limit purchase routes to their supervisor."
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="py-2 pr-4 font-medium">Buyer</th>
                    <th className="py-2 pr-4 font-medium">Approves via</th>
                  </tr>
                </thead>
                <tbody>
                  {data.supervisor_routing.map((r) => (
                    <tr key={r.buyer_user_id} className="border-b last:border-0">
                      <td className="py-2 pr-4">
                        <span className="font-medium">{r.buyer_name}</span>
                        {r.buyer_title ? <span className="text-gray-500"> · {r.buyer_title}</span> : null}
                        {r.is_admin ? (
                          <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">
                            admin
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-4">
                        {r.supervisor_user_id ? (
                          <span>{titleLine(r.supervisor_name || 'Unknown', r.supervisor_title)}</span>
                        ) : (
                          <span className="text-amber-700">
                            No supervisor → falls back to admins
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {noSupervisor.length > 0 && (
              <p className="mt-3 text-xs text-amber-700">
                {noSupervisor.length} non-admin{noSupervisor.length === 1 ? ' has' : 's have'} no
                supervisor on file — their over-limit purchases fall through to the admin pool below.
                Supervisors are set in the HR app.
              </p>
            )}
          </FlowStep>

          <FlowArrow label="if no supervisor resolves…" />

          {/* ── Step 3: Fallback admins ────────────────────────────────── */}
          <FlowStep
            num={3}
            icon={<ShieldCheck className="h-5 w-5" />}
            title="Fallback — any admin"
            subtitle="When neither a location override nor a supervisor resolves, any admin can approve."
          >
            {data.admins.length === 0 ? (
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
          </FlowStep>

          {/* ── Simulator ──────────────────────────────────────────────── */}
          <div className="mt-8 rounded-lg border bg-white p-5">
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
                  {simResult.rule === 'admin_fallback' ? (
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
                  Rule fired: {simResult.explanation}
                </p>
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

function ArrowDownRightLabel() {
  return <span className="mr-1 text-gray-400">approver:</span>;
}
