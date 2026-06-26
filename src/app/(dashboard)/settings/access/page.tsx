'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { getStoredAccessToken, parseJwtPayload } from '@/lib/auth-token';
import { useViewAs } from '@/lib/view-as';
import { ALL_CAPABILITY_KEYS, CAPABILITY_GROUPS } from '@/lib/access';
import { AppError } from '@rocketmanv9/chassis/errors';

const idemKey = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * Position Access editor — a matrix of positions × capabilities. Drives the
 * top-nav "view as position" preview. A position with no row yet is treated as
 * full access (all boxes checked) until you save a narrower set.
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
  // The provider already loads positions, the capability catalog, and grants.
  const { positions, capabilities, grants, refresh, loading } = useViewAs();

  const [isAdmin, setIsAdmin] = useState(false);
  const [draft, setDraft] = useState<Record<string, Set<string>>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    const token = getStoredAccessToken();
    const payload = token ? parseJwtPayload(token) : null;
    setIsAdmin(payload?.app_metadata?.role === 'admin');
  }, []);

  // Seed the editable matrix from grants (absent = full access = all keys).
  useEffect(() => {
    const next: Record<string, Set<string>> = {};
    for (const p of positions) {
      const g = grants[p.id];
      next[p.id] = new Set(g === undefined ? ALL_CAPABILITY_KEYS : g);
    }
    setDraft(next);
  }, [positions, grants]);

  // A row is dirty when its draft differs from the saved grant (treating an
  // unconfigured position as "all keys").
  const dirty = useMemo(() => {
    const d: Record<string, boolean> = {};
    for (const p of positions) {
      const saved = new Set(grants[p.id] === undefined ? ALL_CAPABILITY_KEYS : grants[p.id]);
      const cur = draft[p.id] ?? new Set<string>();
      d[p.id] = saved.size !== cur.size || [...cur].some((k) => !saved.has(k));
    }
    return d;
  }, [positions, grants, draft]);

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

  return (
    <>
      <PageHeader
        title="Position Access"
        description="Choose which sections each HR position can access. Used by the “View as” preview in the top bar. A position with everything checked has full access."
      />

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
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full text-sm">
            <thead>
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
              {positions.map((p) => {
                const set = draft[p.id] ?? new Set<string>();
                return (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium">{p.title}</div>
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
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
