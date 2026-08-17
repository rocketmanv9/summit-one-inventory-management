'use client';

/**
 * Amazon integration hub (item 06, kits/amazon/fleet sprint 2026-08-14).
 *
 * One page answers every question anyone asks about Amazon:
 *   • Is the connection healthy, and is it pointing at test or live?
 *   • Who has an Amazon Business seat, and who is allowed to punch out?
 *   • What has actually flowed through lately, and did it become a PO?
 *   • How many products are mapped, and where do mappings come from?
 *
 * Deliberately read-only where it should be. cXML credentials stay in Vault —
 * this page shows HOSTNAMES only, and never the From Identity or Shared Secret.
 * The test↔active flip is a manual DB step by design, so it renders as a badge,
 * not a toggle. Editing credentials still lives on /settings/integrations.
 *
 * cXML punchout is THE Amazon integration. The SP-API developer account lapsed
 * on purpose (2026-08), so anything that would need a signed Amazon API —
 * order-history import, live pricing feeds, returns — is listed as "not built"
 * rather than half-built.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ShoppingCart,
  Loader2,
  Plus,
  Trash2,
  X,
  Check,
  ExternalLink,
  ShieldCheck,
  ShieldAlert,
  Link2,
  Activity as ActivityIcon,
  Users,
  Briefcase,
} from 'lucide-react';

import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { apiWrite } from '@/lib/api-client';

// ── Types ───────────────────────────────────────────────────────────────

interface Connection {
  provider_id: string;
  provider_key: string;
  display_name: string;
  configured: boolean;
  is_active: boolean;
  integration_mode: string;
  sandbox: boolean;
  webhook_status: string | null;
  punchout_host: string | null;
  punchout_test_host: string | null;
  po_request_host: string | null;
  effective_punchout_host: string | null;
  updated_at: string | null;
}

interface Purchaser {
  id: string;
  user_id: string;
  amazon_email: string | null;
  account_type: 'business' | 'personal';
  can_punch_out: boolean;
  active: boolean;
  notes: string | null;
  name: string | null;
  work_email: string | null;
  role: string | null;
  position_title: string | null;
  spending_limit: number | null;
}

interface Candidate {
  user_id: string;
  name: string | null;
  email: string | null;
  role: string | null;
  position_title: string | null;
  spending_limit: number | null;
}

interface CapabilityPosition {
  position_id: string;
  title: string | null;
  people_count: number;
}

interface ActivityRow {
  id: string;
  status: string;
  user_email: string | null;
  initiated_by: string | null;
  purchaser_name: string | null;
  total: number | null;
  purchase_order_id: string | null;
  po_number: string | null;
  po_status: string | null;
  amazon_order_id: string | null;
  error_message: string | null;
  created_at: string;
  integration_mode: string | null;
}

interface MappingRow {
  id: string;
  asin: string | null;
  title: string | null;
  unit_cost: number | null;
  source_url: string | null;
  mapped_via: string | null;
  created_at: string;
}

interface Overview {
  connection: Connection | null;
  purchasers: Purchaser[];
  candidates: Candidate[];
  capability_positions: CapabilityPosition[];
  gate: { configured: boolean; dormant: boolean };
  activity: ActivityRow[];
  status_counts: Record<string, number>;
  last_session_at: string | null;
  last_successful_at: string | null;
  mappings: { count: number; recent: MappingRow[] };
}

// A failed fetch on a settings screen is UI state, not a server error — and the
// chassis compliance scanner bans raw `throw new Error` under src/, client
// components included. So: no throwing, just a result the caller can render.
async function readJson(res: Response): Promise<{ ok: true; json: any } | { ok: false; message: string }> {
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, message: json?.error?.message || `Request failed (${res.status})` };
  return { ok: true, json };
}

function when(ts: string | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString();
}

const STATUS_TONE: Record<string, string> = {
  confirmed: 'bg-green-50 text-green-700 border-green-200',
  submitted: 'bg-blue-50 text-blue-700 border-blue-200',
  cart_returned: 'bg-amber-50 text-amber-700 border-amber-200',
  punchout_started: 'bg-slate-50 text-slate-700 border-slate-200',
  pending: 'bg-slate-50 text-slate-700 border-slate-200',
  failed: 'bg-red-50 text-red-700 border-red-200',
};

function StatusPill({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? 'bg-slate-50 text-slate-700 border-slate-200';
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tone}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function Card({ title, icon, subtitle, right, children }: {
  title: string;
  icon: React.ReactNode;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-card">
      <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="flex items-start gap-2">
          <div className="mt-0.5 text-muted-foreground">{icon}</div>
          <div>
            <h2 className="font-semibold leading-tight">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

// ── Page ────────────────────────────────────────────────────────────────

export default function AmazonIntegrationHubPage() {
  // Hooks that read shell context only work inside <AppShell> — keep the content
  // in a child component, same as every other settings page here.
  return (
    <AppShell>
      <AmazonHubContent />
    </AppShell>
  );
}

function AmazonHubContent() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [addUserId, setAddUserId] = useState('');
  const [addAmazonEmail, setAddAmazonEmail] = useState('');
  const [addAccountType, setAddAccountType] = useState<'business' | 'personal'>('business');
  const [addNotes, setAddNotes] = useState('');
  const [addErr, setAddErr] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await fetch('/api/settings/integrations/amazon/overview', { credentials: 'include' });
    const out = await readJson(res);
    if (!out.ok) {
      setError(out.message);
      setLoading(false);
      return;
    }
    setData(out.json.data as Overview);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const candidate = useMemo(
    () => data?.candidates.find((c) => c.user_id === addUserId) ?? null,
    [data, addUserId],
  );

  // Default the Amazon email to their work email — right often enough to save
  // typing, and always editable because seats frequently use another address.
  useEffect(() => {
    if (candidate && !addAmazonEmail) setAddAmazonEmail(candidate.email ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addUserId]);

  const resetAdd = () => {
    setAdding(false);
    setAddUserId('');
    setAddAmazonEmail('');
    setAddAccountType('business');
    setAddNotes('');
    setAddErr('');
  };

  const submitAdd = async () => {
    if (!addUserId) { setAddErr('Pick a person first.'); return; }
    setSaving(true);
    setAddErr('');
    const res = await apiWrite('/api/settings/integrations/amazon/purchasers', {
      method: 'POST',
      body: {
        user_id: addUserId,
        amazon_email: addAmazonEmail.trim() || null,
        account_type: addAccountType,
        notes: addNotes.trim() || null,
      },
    });
    const out = await readJson(res);
    setSaving(false);
    if (!out.ok) { setAddErr(out.message); return; }
    resetAdd();
    load();
  };

  const patch = async (row: Purchaser, body: Record<string, unknown>) => {
    setBusyId(row.id);
    const res = await apiWrite(`/api/settings/integrations/amazon/purchasers/${row.id}`, { method: 'PATCH', body });
    const out = await readJson(res);
    setBusyId(null);
    if (!out.ok) { setError(out.message); return; }
    load();
  };

  const remove = async (row: Purchaser) => {
    setBusyId(row.id);
    const res = await apiWrite(`/api/settings/integrations/amazon/purchasers/${row.id}`, { method: 'DELETE' });
    const out = await readJson(res);
    setBusyId(null);
    if (!out.ok) { setError(out.message); return; }
    load();
  };

  const conn = data?.connection ?? null;
  const dormant = data?.gate.dormant ?? true;

  return (
    <div className="p-6">
      <PageHeader
        title="Amazon Business"
        description="The whole integration on one page: is the connection healthy, who has an Amazon seat, who may punch out, and what has flowed through lately."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Link
          href="/settings/integrations"
          className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 hover:bg-muted"
        >
          <ExternalLink className="h-3.5 w-3.5" /> cXML credentials & mappings editor
        </Link>
        <button onClick={load} className="rounded-md border px-3 py-1.5 hover:bg-muted">Refresh</button>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading Amazon integration…
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">

          {/* ── Connection ─────────────────────────────────────────────── */}
          <Card
            title="Connection"
            icon={<ShoppingCart className="h-4 w-4" />}
            subtitle="cXML punchout is the whole integration. Credentials live in Vault — hostnames only here."
            right={
              conn?.configured ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                  <ShieldCheck className="h-3 w-3" /> Configured
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                  <ShieldAlert className="h-3 w-3" /> Not configured
                </span>
              )
            }
          >
            {!conn ? (
              <p className="text-sm text-muted-foreground">
                No Amazon Business provider row for this tenant yet. Add cXML credentials on{' '}
                <Link className="underline" href="/settings/integrations">Settings → Integrations</Link> to create one.
              </p>
            ) : (
              <div className="space-y-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                      conn.integration_mode === 'active'
                        ? 'border-green-200 bg-green-50 text-green-700'
                        : 'border-amber-200 bg-amber-50 text-amber-700'
                    }`}
                  >
                    mode: {conn.integration_mode}
                  </span>
                  <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                    endpoint: {conn.sandbox ? 'test' : 'live'}
                  </span>
                  {!conn.is_active && (
                    <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs text-red-700">
                      provider inactive
                    </span>
                  )}
                </div>
                <p className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
                  Flipping <span className="font-mono">integration_mode</span> between test and active is a manual DB
                  step on purpose — no button here can send real money by accident.
                </p>

                <dl className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">Punchout host (live)</dt>
                    <dd className="font-mono text-xs">{conn.punchout_host ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Punchout host (test)</dt>
                    <dd className="font-mono text-xs">{conn.punchout_test_host ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">PO request host</dt>
                    <dd className="font-mono text-xs">{conn.po_request_host ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">In use right now</dt>
                    <dd className="font-mono text-xs">{conn.effective_punchout_host ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Last punchout session</dt>
                    <dd>{when(data?.last_session_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Last order submitted</dt>
                    <dd>{when(data?.last_successful_at)}</dd>
                  </div>
                </dl>

                <p className="text-xs text-muted-foreground">
                  Not built (and not planned): SP-API order-history import, live price feeds and returns. The Amazon
                  developer account was allowed to lapse in Aug 2026 — punchout carries everything.
                </p>
              </div>
            )}
          </Card>

          {/* ── Purchasers ─────────────────────────────────────────────── */}
          <Card
            title="Who can purchase"
            icon={<Users className="h-4 w-4" />}
            subtitle="People with an Amazon Business seat, and whether they may start a punchout session."
            right={
              <button
                onClick={() => setAdding((v) => !v)}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-white hover:bg-primary/90"
              >
                {adding ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                {adding ? 'Cancel' : 'Add purchaser'}
              </button>
            }
          >
            <div
              className={`mb-3 rounded-md border p-2 text-xs ${
                dormant ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-green-200 bg-green-50 text-green-800'
              }`}
            >
              {dormant ? (
                <>
                  <strong>Gate dormant.</strong> Nobody is registered, so punchout works for everyone exactly as it did
                  before this page existed. Add the first purchaser and the list immediately becomes the rule —
                  including for admins.
                </>
              ) : (
                <>
                  <strong>Gate live.</strong> Only the people below with punchout enabled can start an Amazon session.
                  Everyone else gets &ldquo;ask an admin to add you as an Amazon purchaser&rdquo;. Remove every row to
                  make it dormant again.
                </>
              )}
            </div>

            {/* Positions with Amazon buying — the OTHER grant path (item 07).
                A position that carries the `amazon.punchout` capability may
                punch out without an individual seat below, so admins can
                authorize a whole role. Read-only here; edit the capability set
                in the access editor. */}
            <div className="mb-3 rounded-md border bg-muted/20 p-3">
              <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-foreground">
                <Briefcase className="h-3.5 w-3.5" /> Positions with Amazon buying
              </div>
              {(data?.capability_positions?.length ?? 0) === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No position grants Amazon buying yet. Grant the &ldquo;Order through Amazon&rdquo; capability to a
                  position in the{' '}
                  <Link href="/settings/access" className="underline">access editor</Link> to let a whole role punch
                  out without an individual seat.
                </p>
              ) : (
                <>
                  <p className="mb-2 text-xs text-muted-foreground">
                    Anyone in these positions may start an Amazon punchout even without an individual seat below.
                  </p>
                  <ul className="flex flex-wrap gap-1.5">
                    {data?.capability_positions.map((cp) => (
                      <li
                        key={cp.position_id}
                        className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs text-green-800"
                      >
                        {cp.title || 'Untitled position'}
                        {cp.people_count > 0 && (
                          <span className="text-green-600">· {cp.people_count}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Edit which positions get this in the{' '}
                    <Link href="/settings/access" className="underline">access editor</Link>.
                  </p>
                </>
              )}
            </div>

            {adding && (
              <div className="mb-3 space-y-2 rounded-md border bg-muted/30 p-3">
                <select
                  value={addUserId}
                  onChange={(e) => setAddUserId(e.target.value)}
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                >
                  <option value="">Select a person…</option>
                  {data?.candidates.map((c) => (
                    <option key={c.user_id} value={c.user_id}>
                      {c.name || c.email || c.user_id}
                      {c.position_title ? ` — ${c.position_title}` : ''}
                    </option>
                  ))}
                </select>
                {candidate && (
                  <p className="text-xs text-muted-foreground">
                    {candidate.position_title || 'No position'}
                    {candidate.spending_limit != null && ` · spending limit $${Number(candidate.spending_limit).toLocaleString()}`}
                    {candidate.role && ` · ${candidate.role}`}
                  </p>
                )}
                <input
                  value={addAmazonEmail}
                  onChange={(e) => setAddAmazonEmail(e.target.value)}
                  placeholder="Amazon Business email (often not their work email)"
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                />
                <select
                  value={addAccountType}
                  onChange={(e) => setAddAccountType(e.target.value as 'business' | 'personal')}
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                >
                  <option value="business">Business account</option>
                  <option value="personal">Personal account</option>
                </select>
                <input
                  value={addNotes}
                  onChange={(e) => setAddNotes(e.target.value)}
                  placeholder="Notes (optional)"
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                />
                {addErr && <p className="text-xs text-red-600">{addErr}</p>}
                <button
                  onClick={submitAdd}
                  disabled={saving}
                  className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Register purchaser
                </button>
              </div>
            )}

            {data?.purchasers.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No Amazon purchasers registered yet.
              </p>
            ) : (
              <ul className="divide-y">
                {data?.purchasers.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{p.name || p.work_email || p.user_id}</span>
                        {!p.active && (
                          <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] text-red-700">
                            inactive
                          </span>
                        )}
                        {p.account_type === 'personal' && (
                          <span className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">
                            personal account
                          </span>
                        )}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {p.amazon_email || 'no Amazon email on file'}
                        {p.position_title && ` · ${p.position_title}`}
                        {p.spending_limit != null && ` · limit $${Number(p.spending_limit).toLocaleString()}`}
                      </div>
                      {p.notes && <div className="text-xs text-muted-foreground">{p.notes}</div>}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => patch(p, { can_punch_out: !p.can_punch_out })}
                        disabled={busyId === p.id}
                        className={`rounded-md border px-2 py-1 text-xs ${
                          p.can_punch_out
                            ? 'border-green-200 bg-green-50 text-green-700'
                            : 'text-muted-foreground'
                        }`}
                        title="May start an Amazon punchout session"
                      >
                        {p.can_punch_out ? 'punchout on' : 'punchout off'}
                      </button>
                      <button
                        onClick={() => patch(p, { active: !p.active })}
                        disabled={busyId === p.id}
                        className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                      >
                        {p.active ? 'deactivate' : 'activate'}
                      </button>
                      <button
                        onClick={() => remove(p)}
                        disabled={busyId === p.id}
                        className="rounded-md border px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                        title="Remove from the registry"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* ── Activity ───────────────────────────────────────────────── */}
          <Card
            title="Recent punchout sessions"
            icon={<ActivityIcon className="h-4 w-4" />}
            subtitle="The last 20 sessions: who shopped, what came back, and which PO it became."
          >
            <div className="mb-3 flex flex-wrap gap-2">
              {Object.entries(data?.status_counts ?? {}).map(([status, count]) => (
                <span key={status} className="inline-flex items-center gap-1 text-xs">
                  <StatusPill status={status} />
                  <span className="text-muted-foreground">{count}</span>
                </span>
              ))}
              {Object.keys(data?.status_counts ?? {}).length === 0 && (
                <span className="text-xs text-muted-foreground">No sessions yet.</span>
              )}
            </div>

            {data?.activity.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nobody has punched out to Amazon from this tenant yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="py-1 pr-3 font-medium">Who</th>
                      <th className="py-1 pr-3 font-medium">When</th>
                      <th className="py-1 pr-3 font-medium">Status</th>
                      <th className="py-1 pr-3 font-medium">Total</th>
                      <th className="py-1 font-medium">PO</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data?.activity.map((a) => (
                      <tr key={a.id}>
                        <td className="py-1.5 pr-3">
                          <div className="truncate">{a.purchaser_name || a.user_email || '—'}</div>
                          {a.purchaser_name && a.user_email && (
                            <div className="truncate text-xs text-muted-foreground">{a.user_email}</div>
                          )}
                        </td>
                        <td className="whitespace-nowrap py-1.5 pr-3 text-xs text-muted-foreground">
                          {new Date(a.created_at).toLocaleString()}
                        </td>
                        <td className="py-1.5 pr-3"><StatusPill status={a.status} /></td>
                        <td className="whitespace-nowrap py-1.5 pr-3 font-mono text-xs">
                          {a.total != null ? `$${Number(a.total).toFixed(2)}` : '—'}
                        </td>
                        <td className="py-1.5">
                          {a.purchase_order_id ? (
                            <Link
                              href={`/inventory/purchasing?po=${a.purchase_order_id}`}
                              className="text-primary underline"
                            >
                              {a.po_number || 'view PO'}
                            </Link>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* ── Mappings ───────────────────────────────────────────────── */}
          <Card
            title="Product mappings"
            icon={<Link2 className="h-4 w-4" />}
            subtitle="Catalog items tied to an ASIN. Buyers create these inline by pasting an Amazon link on a PO line."
            right={
              <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                {data?.mappings.count ?? 0} mapped
              </span>
            }
          >
            {data?.mappings.recent.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No Amazon mappings yet. Paste an Amazon link on a purchase-order line and the mapping writes itself.
              </p>
            ) : (
              <ul className="divide-y">
                {data?.mappings.recent.map((m) => (
                  <li key={m.id} className="py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm">{m.title || m.asin || 'Untitled product'}</div>
                        <div className="text-xs text-muted-foreground">
                          <span className="font-mono">{m.asin}</span>
                          {m.unit_cost != null && ` · $${Number(m.unit_cost).toFixed(2)}`}
                          {m.mapped_via && ` · via ${m.mapped_via.replace(/_/g, ' ')}`}
                        </div>
                      </div>
                      {m.source_url && (
                        <a
                          href={m.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 text-muted-foreground hover:text-foreground"
                          title="Open on Amazon"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
