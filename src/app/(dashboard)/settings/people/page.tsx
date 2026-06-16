'use client';

import { useEffect, useState, useCallback } from 'react';
import { Loader2, RefreshCw, Users, Briefcase, Bot } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { getStoredAccessToken, parseJwtPayload } from '@/lib/auth-token';
import { AppError } from '@rocketmanv9/chassis/errors';

interface Position {
  id: string;
  hr_position_id: string | null;
  title: string;
  role_level: string | null;
  role_level_rank: number | null;
  spending_limit: number | string | null;
  is_active: boolean;
  source: string;
}

type BudgetPeriod = 'weekly' | 'monthly' | 'quarterly' | 'annual';

interface UserRow {
  user_id: string;
  name: string | null;
  email: string | null;
  role: string | null;
  position_id: string | null;
  position_title: string | null;
  spending_limit: number | string | null;
  position_limit: number | string | null;
  effective_limit: number | string | null;
  effective_source: 'user' | 'position' | 'tenant' | 'none';
  hr_person_id: string | null;
  // Periodic (cumulative) budget — config + live usage for the current window.
  budget_amount: number | string | null;
  budget_period: BudgetPeriod | null;
  budget_anchor: string | null;
  budget_spent: number | string | null;
  budget_remaining: number | string | null;
  budget_period_start: string | null;
  budget_period_end: string | null;
}

interface RosterMember {
  hr_person_id: string;
  name: string;
  email: string | null;
  employment_status: string | null;
  is_active: boolean;
  position_title: string | null;
  position_limit: number | string | null;
  effective_limit: number | string | null;
  is_app_user: boolean;
}

interface Overview {
  hrConfigured: boolean;
  positions: Position[];
  users: UserRow[];
  roster: RosterMember[];
  settings: {
    auto_approve_limit: number | string | null;
    agent_auto_order_enabled: boolean;
    agent_auto_order_limit: number | string | null;
    hr_tenant_id: string | null;
  };
}

const idemKey = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
const fmtMoney = (v: unknown): string => {
  const n = num(v);
  return n === null ? '—' : `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
};

async function patchJson(url: string, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-idempotency-key': idemKey('hr') },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw AppError.internal(json?.error?.message || `Request failed (${res.status})`);
  return json.data ?? json;
}

const fmtDate = (s: string | null): string =>
  !s ? '—' : new Date(`${s}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const firstOfThisMonth = (): string => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };

/**
 * Per-user periodic budget editor. Amount + cadence + the date periods are anchored to.
 * Clearing the amount (or picking "no budget") removes the budget. Saves on blur/change.
 */
function BudgetEditor({ row, disabled, onSave }: {
  row: UserRow;
  disabled: boolean;
  onSave: (b: { amount: number; period: BudgetPeriod; anchor: string } | null) => void;
}) {
  const [amount, setAmount] = useState<string>(num(row.budget_amount)?.toString() ?? '');
  const [period, setPeriod] = useState<BudgetPeriod | ''>(row.budget_period ?? '');
  const [anchor, setAnchor] = useState<string>(row.budget_anchor ?? firstOfThisMonth());

  const commit = (next: { amount?: string; period?: BudgetPeriod | ''; anchor?: string }) => {
    const a = next.amount ?? amount;
    const p = next.period ?? period;
    const an = next.anchor ?? anchor;
    if (a === '' || Number(a) <= 0) { onSave(null); return; }      // no/zero amount => clear
    const effP: BudgetPeriod = (p || 'monthly') as BudgetPeriod;     // default cadence if amount set first
    const effAn = an || firstOfThisMonth();
    if (!p) setPeriod(effP);
    if (!an) setAnchor(effAn);
    onSave({ amount: Number(a), period: effP, anchor: effAn });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        <span className="text-gray-400">$</span>
        <input
          type="number" min="0" value={amount} disabled={disabled} placeholder="none"
          onChange={(e) => setAmount(e.target.value)}
          onBlur={(e) => { if (e.target.value !== (num(row.budget_amount)?.toString() ?? '')) commit({ amount: e.target.value }); }}
          className="w-24 rounded-md border px-2 py-1 text-right"
        />
        <select
          value={period} disabled={disabled || amount === ''}
          onChange={(e) => { const p = e.target.value as BudgetPeriod | ''; setPeriod(p); commit({ period: p }); }}
          className="rounded-md border px-1 py-1 text-xs"
        >
          <option value="">no budget</option>
          <option value="weekly">/ week</option>
          <option value="monthly">/ month</option>
          <option value="quarterly">/ quarter</option>
          <option value="annual">/ year</option>
        </select>
      </div>
      {amount !== '' && period && (
        <label className="flex items-center gap-1 text-[11px] text-gray-400">
          resets from
          <input
            type="date" value={anchor} disabled={disabled}
            onChange={(e) => { setAnchor(e.target.value); commit({ anchor: e.target.value }); }}
            className="rounded border px-1 py-0.5 text-[11px]"
          />
        </label>
      )}
    </div>
  );
}

export default function PeopleSettingsPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hr/overview', { credentials: 'include' });
      const json = await res.json();
      if (!res.ok) throw AppError.internal(json?.error?.message || 'Failed to load');
      setData(json.data as Overview);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const token = getStoredAccessToken();
    const payload = token ? parseJwtPayload(token) : null;
    setIsAdmin(payload?.app_metadata?.role === 'admin');
    load();
  }, [load]);

  const flash = (m: string) => { setMsg(m); setErr(''); setTimeout(() => setMsg(''), 3000); };
  const fail = (e: any) => { setErr(e.message || String(e)); };

  const runSync = async () => {
    setSyncing(true); setErr(''); setMsg('');
    try {
      const res = await fetch('/api/hr/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-idempotency-key': idemKey('hr-sync') },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) throw AppError.internal(json?.error?.message || 'Sync failed');
      const d = json.data ?? json;
      if (!d.configured) flash('HR not configured — set HR_SUPABASE_* env to sync.');
      else flash(`Synced ${d.positionsSynced} positions · matched ${d.usersMatched} users.`);
      await load();
    } catch (e) { fail(e); } finally { setSyncing(false); }
  };

  const savePositionLimit = async (id: string, raw: string) => {
    try {
      await patchJson(`/api/hr/positions/${id}`, { spending_limit: raw === '' ? null : Number(raw) });
      flash('Position limit saved.');
      await load();
    } catch (e) { fail(e); }
  };

  const saveUser = async (userId: string, patch: { position_id?: string | null; spending_limit?: number | null }) => {
    try {
      await patchJson(`/api/hr/users/${userId}`, patch);
      flash('User updated.');
      await load();
    } catch (e) { fail(e); }
  };

  const saveUserBudget = async (userId: string, budget: { amount: number; period: BudgetPeriod; anchor: string } | null) => {
    try {
      await patchJson(`/api/hr/users/${userId}`, { budget });
      flash(budget ? 'Budget saved.' : 'Budget cleared.');
      await load();
    } catch (e) { fail(e); }
  };

  const saveAgent = async (patch: { agent_auto_order_enabled?: boolean; agent_auto_order_limit?: number | null }) => {
    try {
      await patchJson('/api/hr/settings', patch);
      flash('Agent settings saved.');
      await load();
    } catch (e) { fail(e); }
  };

  return (
    <AppShell>
      <PageHeader title="People & Limits" description="Positions and users from HR, with purchasing spend limits." />

      {!isAdmin && (
        <div className="mb-4 rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
          You need the admin role to change limits. Fields are read-only.
        </div>
      )}
      {err && <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{err}</div>}
      {msg && <div className="mb-4 rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-700">{msg}</div>}

      {loading || !data ? (
        <div className="flex items-center gap-2 text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : (
        <div className="space-y-8">
          {/* Sync bar */}
          <div className="flex items-center justify-between rounded-lg border bg-white p-4">
            <div className="text-sm text-gray-600">
              {data.hrConfigured
                ? 'Pull the latest positions and people from HR (summit-one-hr). Limits you set here are preserved.'
                : 'HR integration is not configured. You can still manage limits manually below.'}
            </div>
            <button
              onClick={runSync}
              disabled={syncing || !isAdmin}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Sync from HR
            </button>
          </div>

          {/* Agent auto-order cap */}
          <section className="rounded-lg border bg-white p-4">
            <h2 className="mb-1 flex items-center gap-2 text-base font-semibold"><Bot className="h-4 w-4" /> AI agent spend cap</h2>
            <p className="mb-4 text-sm text-gray-500">
              Caps what the AI agent can auto-order per purchase order. Orders over the cap (or when off) go to draft for your approval.
              Separate from the human auto-approve limit on the Purchasing settings page.
            </p>
            <div className="flex flex-wrap items-end gap-6">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={data.settings.agent_auto_order_enabled}
                  disabled={!isAdmin}
                  onChange={(e) => saveAgent({ agent_auto_order_enabled: e.target.checked })}
                />
                Allow the agent to place orders automatically
              </label>
              <div>
                <label className="block text-xs font-medium text-gray-500">Per-order agent cap ($)</label>
                <input
                  type="number"
                  min="0"
                  defaultValue={num(data.settings.agent_auto_order_limit) ?? ''}
                  disabled={!isAdmin}
                  placeholder="No cap"
                  onBlur={(e) => saveAgent({ agent_auto_order_limit: e.target.value === '' ? null : Number(e.target.value) })}
                  className="mt-1 w-40 rounded-md border px-2 py-1 text-sm"
                />
              </div>
            </div>
          </section>

          {/* Positions */}
          <section className="rounded-lg border bg-white p-4">
            <h2 className="mb-1 flex items-center gap-2 text-base font-semibold"><Briefcase className="h-4 w-4" /> Positions ({data.positions.length})</h2>
            <p className="mb-4 text-sm text-gray-500">Default per-order spend cap for everyone in this position. Blank = use the tenant global limit ({fmtMoney(data.settings.auto_approve_limit)}).</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left text-xs uppercase text-gray-400">
                  <th className="py-2">Position</th><th>Level</th><th>Source</th><th className="text-right">Per-order limit ($)</th>
                </tr></thead>
                <tbody>
                  {data.positions.map((p) => (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="py-2 font-medium">{p.title}</td>
                      <td className="text-gray-600">{p.role_level ?? '—'}</td>
                      <td className="text-gray-400">{p.source}</td>
                      <td className="text-right">
                        <input
                          type="number" min="0"
                          defaultValue={num(p.spending_limit) ?? ''}
                          disabled={!isAdmin}
                          placeholder="global"
                          onBlur={(e) => { if ((num(e.target.value) ?? null) !== num(p.spending_limit)) savePositionLimit(p.id, e.target.value); }}
                          className="w-32 rounded-md border px-2 py-1 text-right"
                        />
                      </td>
                    </tr>
                  ))}
                  {data.positions.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-gray-400">No positions yet — run Sync from HR.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          {/* Users */}
          <section className="rounded-lg border bg-white p-4">
            <h2 className="mb-1 flex items-center gap-2 text-base font-semibold"><Users className="h-4 w-4" /> Users ({data.users.length})</h2>
            <p className="mb-4 text-sm text-gray-500">
              <span className="font-medium text-gray-600">Per-order cap</span> (Override → Effective): the biggest single PO that auto-approves.{' '}
              <span className="font-medium text-gray-600">Period budget</span>: a recurring pool of approved spend; once it&apos;s used up for the period, new POs go to draft until it resets. Both must pass to auto-approve.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left text-xs uppercase text-gray-400">
                  <th className="py-2">User</th><th>Position</th><th className="text-right">Override ($)</th><th className="text-right">Effective</th><th className="text-right">Period budget</th><th className="text-right">This period</th>
                </tr></thead>
                <tbody>
                  {data.users.map((u) => (
                    <tr key={u.user_id} className="border-b last:border-0">
                      <td className="py-2">
                        <div className="font-medium">{u.name || u.email || u.user_id.slice(0, 8)}</div>
                        <div className="text-xs text-gray-400">{u.email}{u.role === 'admin' ? ' · admin' : ''}</div>
                      </td>
                      <td>
                        <select
                          value={u.position_id ?? ''}
                          disabled={!isAdmin}
                          onChange={(e) => saveUser(u.user_id, { position_id: e.target.value || null })}
                          className="rounded-md border px-2 py-1"
                        >
                          <option value="">— none —</option>
                          {data.positions.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                        </select>
                      </td>
                      <td className="text-right">
                        <input
                          type="number" min="0"
                          defaultValue={num(u.spending_limit) ?? ''}
                          disabled={!isAdmin}
                          placeholder="inherit"
                          onBlur={(e) => { if ((num(e.target.value) ?? null) !== num(u.spending_limit)) saveUser(u.user_id, { spending_limit: e.target.value === '' ? null : Number(e.target.value) }); }}
                          className="w-28 rounded-md border px-2 py-1 text-right"
                        />
                      </td>
                      <td className="text-right">
                        <span className="font-medium">{u.effective_limit == null ? 'No cap' : fmtMoney(u.effective_limit)}</span>
                        <span className="ml-1 text-xs text-gray-400">({u.effective_source})</span>
                      </td>
                      <td className="text-right">
                        <BudgetEditor row={u} disabled={!isAdmin} onSave={(b) => saveUserBudget(u.user_id, b)} />
                      </td>
                      <td className="text-right align-middle">
                        {u.budget_amount == null ? (
                          <span className="text-gray-300">—</span>
                        ) : (
                          <div className="text-xs">
                            <div className="font-medium text-gray-700">
                              {fmtMoney(u.budget_spent)} <span className="text-gray-400">of</span> {fmtMoney(u.budget_amount)}
                            </div>
                            <div className={num(u.budget_remaining) != null && num(u.budget_remaining)! <= 0 ? 'text-red-600' : 'text-green-600'}>
                              {fmtMoney(u.budget_remaining)} left
                            </div>
                            <div className="text-gray-400">resets {fmtDate(u.budget_period_end)}</div>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {data.users.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-gray-400">No users yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          {/* HR roster — all people (read-only) */}
          <section className="rounded-lg border bg-white p-4">
            <h2 className="mb-1 flex items-center gap-2 text-base font-semibold"><Users className="h-4 w-4" /> HR roster ({data.roster.length})</h2>
            <p className="mb-4 text-sm text-gray-500">Everyone in HR, refreshed on sync and live via HR events. Read-only — set caps on Positions (everyone) or Users (app logins) above. People with an app login are tagged.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left text-xs uppercase text-gray-400">
                  <th className="py-2">Name</th><th>Position</th><th>Status</th><th className="text-right">Position cap</th>
                </tr></thead>
                <tbody>
                  {data.roster.map((m) => (
                    <tr key={m.hr_person_id} className="border-b last:border-0">
                      <td className="py-2">
                        <div className="font-medium">{m.name}{m.is_app_user && <span className="ml-2 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600">app user</span>}</div>
                        <div className="text-xs text-gray-400">{m.email}</div>
                      </td>
                      <td className="text-gray-600">{m.position_title ?? '—'}</td>
                      <td className="text-gray-500">{m.employment_status ?? (m.is_active ? 'active' : 'inactive')}</td>
                      <td className="text-right">{m.effective_limit == null ? 'No cap' : fmtMoney(m.effective_limit)}</td>
                    </tr>
                  ))}
                  {data.roster.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-gray-400">No people yet — run Sync from HR.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </AppShell>
  );
}
