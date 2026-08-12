'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { useViewAs, type ViewAsPosition } from '@/lib/view-as';
import { ALL_CAPABILITY_KEYS, CAPABILITY_GROUPS } from '@/lib/access';
import { AppError } from '@rocketmanv9/chassis/errors';
import { CountQualificationsSection } from '@/components/settings/CountQualificationsSection';

const idemKey = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * Position Access editor — a matrix of positions × capabilities. Drives the
 * top-nav / corner "view as position" picker and real per-position access.
 *
 * DENY BY DEFAULT: a position you haven't configured has no access. Positions are
 * split into "Configured" and "Not configured" groups for clarity. Admins &
 * developers always keep full access regardless.
 */
export default function PositionAccessPage() {
  // AccessEditor must live INSIDE AppShell so it can read the ViewAsProvider
  // (the provider is mounted by AppShell, not above this page).
  return (
    <AppShell>
      <AccessEditor />
    </AppShell>
  );
}

function AccessEditor() {
  // The provider already loads positions, the capability catalog, grants, and
  // the server-confirmed admin flag (which drives edit permission).
  const { positions, capabilities, grants, refresh, loading, isAdmin } = useViewAs();

  const [draft, setDraft] = useState<Record<string, Set<string>>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  // Seed the editable matrix from grants. Unconfigured (no row) = no access =
  // nothing checked (deny by default).
  useEffect(() => {
    const next: Record<string, Set<string>> = {};
    for (const p of positions) next[p.id] = new Set(grants[p.id] ?? []);
    setDraft(next);
  }, [positions, grants]);

  // A position is "configured" once it has a saved capability row.
  const isConfigured = (id: string) => grants[id] !== undefined;

  // A row is dirty when its draft differs from the saved grant (unconfigured = none).
  const dirty = useMemo(() => {
    const d: Record<string, boolean> = {};
    for (const p of positions) {
      const saved = new Set(grants[p.id] ?? []);
      const cur = draft[p.id] ?? new Set<string>();
      d[p.id] = saved.size !== cur.size || [...cur].some((k) => !saved.has(k));
    }
    return d;
  }, [positions, grants, draft]);

  const configured = useMemo(() => positions.filter((p) => isConfigured(p.id)), [positions, grants]);
  const unconfigured = useMemo(() => positions.filter((p) => !isConfigured(p.id)), [positions, grants]);

  const toggle = (positionId: string, key: string) => {
    setDraft((prev) => {
      const cur = new Set(prev[positionId] ?? []);
      if (cur.has(key)) cur.delete(key); else cur.add(key);
      return { ...prev, [positionId]: cur };
    });
  };

  const setAll = (positionId: string, on: boolean) => {
    setDraft((prev) => ({ ...prev, [positionId]: new Set(on ? ALL_CAPABILITY_KEYS : []) }));
  };

  const save = async (positionId: string) => {
    setSavingId(positionId); setErr(''); setMsg('');
    try {
      const res = await fetch('/api/positions/access', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-idempotency-key': idemKey('pos-access') },
        credentials: 'include',
        body: JSON.stringify({ position_id: positionId, capability_keys: [...(draft[positionId] ?? [])] }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw AppError.internal(json?.error?.message || `Save failed (${res.status})`);
      setMsg('Access saved.');
      setTimeout(() => setMsg(''), 3000);
      await refresh();
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setSavingId(null);
    }
  };

  const colSpan = capabilities.length + 2;

  const renderRow = (p: ViewAsPosition) => {
    const set = draft[p.id] ?? new Set<string>();
    const configuredRow = isConfigured(p.id);
    return (
      <tr key={p.id} className={`border-b last:border-0 ${configuredRow ? '' : 'bg-gray-50'}`}>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="font-medium">{p.title}</span>
            {configuredRow ? (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-green-700">Configured</span>
            ) : (
              <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500">Not configured — no access</span>
            )}
          </div>
          <div className="text-xs text-gray-400">
            {p.role_level ?? '—'}
            {' · '}
            <button className="underline hover:text-gray-600" disabled={!isAdmin} onClick={() => setAll(p.id, true)}>all</button>
            {' / '}
            <button className="underline hover:text-gray-600" disabled={!isAdmin} onClick={() => setAll(p.id, false)}>none</button>
          </div>
        </td>
        {capabilities.map((c) => (
          <td key={c.key} className="px-3 py-3 text-center">
            <input
              type="checkbox"
              checked={set.has(c.key)}
              disabled={!isAdmin}
              onChange={() => toggle(p.id, c.key)}
              className="h-4 w-4 cursor-pointer accent-primary"
            />
          </td>
        ))}
        <td className="px-4 py-3 text-right">
          <button
            onClick={() => save(p.id)}
            disabled={!isAdmin || !dirty[p.id] || savingId === p.id}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-40"
          >
            {savingId === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Save
          </button>
        </td>
      </tr>
    );
  };

  const groupHeader = (label: string, count: number, hint?: string) => (
    <tr className="bg-gray-100">
      <td colSpan={colSpan} className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {label} <span className="text-gray-400">({count})</span>
        {hint && <span className="ml-2 normal-case font-normal text-gray-400">{hint}</span>}
      </td>
    </tr>
  );

  return (
    <>
      <PageHeader
        title="Position Access"
        description="Choose which sections & actions each HR position can access. Deny by default: a position you haven’t configured has no access until you grant it. Admins & developers always keep full access."
      />

      <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        <p className="font-medium text-blue-900">How this is enforced</p>
        <p className="mt-1">
          <span className="font-medium">Section checkboxes</span> (Dashboard, Inventory, …) control navigation:
          restricted users don&apos;t see those sections and are bounced if they open a link directly.
          <span className="font-medium"> Action checkboxes</span> (manage vendors, preferred vendors, purchase
          orders) are additionally enforced on the server — API calls without the capability are rejected, no
          matter what the UI shows. The &quot;View as&quot; picker in the top bar previews any position&apos;s
          view without changing your own access.
        </p>
      </div>

      {!isAdmin && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          You need the admin role to change access. The matrix is read-only.
        </div>
      )}
      {err && <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div>}
      {msg && <div className="mb-4 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">{msg}</div>}

      {loading && positions.length === 0 ? (
        <div className="flex items-center gap-2 text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : positions.length === 0 ? (
        <div className="rounded-lg border bg-white p-6 text-center text-sm text-gray-500">
          No positions yet — sync them on <a className="text-primary underline" href="/settings/people">People &amp; Limits</a>.
        </div>
      ) : (
        <>
          <div className="mb-3 text-sm text-gray-500">
            <span className="font-medium text-gray-700">{configured.length}</span> configured ·{' '}
            <span className="font-medium text-gray-700">{unconfigured.length}</span> not configured (no access)
          </div>
          <div className="overflow-x-auto rounded-lg border bg-white">
            <table className="w-full text-sm">
              <thead>
                {/* (Count Qualifications lives below this matrix — same page,
                    per-person rather than per-position.) */}
                {/* Group header row */}
                <tr className="border-b text-left text-[11px] uppercase tracking-wide text-gray-400">
                  <th className="px-4 pt-3" />
                  {CAPABILITY_GROUPS.map((g) => (
                    <th key={g.group} colSpan={g.items.length} className="border-l px-3 pt-3 text-center font-semibold">
                      {g.group}
                    </th>
                  ))}
                  <th className="px-4 pt-3" />
                </tr>
                {/* Capability header row */}
                <tr className="border-b text-left text-xs uppercase text-gray-400">
                  <th className="px-4 pb-3"><ShieldCheck className="mr-1 inline h-3.5 w-3.5" />Position</th>
                  {capabilities.map((c, i) => (
                    <th
                      key={c.key}
                      className={`px-3 pb-3 text-center align-bottom ${i === 0 || capabilities[i - 1]?.group !== c.group ? 'border-l' : ''}`}
                      title={c.description}
                    >
                      {c.label}
                    </th>
                  ))}
                  <th className="px-4 pb-3" />
                </tr>
              </thead>
              <tbody>
                {configured.length > 0 && (
                  <Fragment key="configured">
                    {groupHeader('Configured', configured.length)}
                    {configured.map(renderRow)}
                  </Fragment>
                )}
                {unconfigured.length > 0 && (
                  <Fragment key="unconfigured">
                    {groupHeader('Not configured', unconfigured.length, 'no access until granted')}
                    {unconfigured.map(renderRow)}
                  </Fragment>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Per-person count qualifications — merged onto this page so people
          permissions live in one place (was /settings/count-qualifications). */}
      <CountQualificationsSection isAdmin={isAdmin} />
    </>
  );
}
