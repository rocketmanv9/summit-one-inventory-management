'use client';

// ---------------------------------------------------------------------------
// Access + "view as position" context.
//
// Two jobs:
//  1. ENFORCEMENT — `can(key)` reflects the REAL logged-in user's effective
//     capabilities (from /api/positions/my-access). Action capabilities are
//     ALSO enforced server-side (src/lib/access-server.ts); this just hides the
//     buttons. Admins / unconfigured positions get full access.
//  2. PREVIEW — admins can pick a position in the top nav to preview the app as
//     them; while previewing, `can(key)` reflects THAT position's grants. The
//     selection is remembered in localStorage. Preview is visual only.
// ---------------------------------------------------------------------------

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useSession } from '@/hooks/useSession';
import {
  ACCESS_CAPABILITIES,
  ALL_CAPABILITY_KEYS,
  capabilitiesForGrant,
  type AccessCapability,
} from '@/lib/access';

export interface ViewAsPosition {
  id: string;
  title: string;
  role_level: string | null;
}

interface ViewAsValue {
  /** Admin/developer only — whether the picker should be shown at all. */
  enabled: boolean;
  /** Server-confirmed admin (local_users.role) — drives edit permission. */
  isAdmin: boolean;
  loading: boolean;
  positions: ViewAsPosition[];
  capabilities: AccessCapability[];
  /** position_id → granted capability keys (absent = full access). */
  grants: Record<string, string[]>;
  /** null = viewing as yourself (full access, no preview). */
  selectedPositionId: string | null;
  selectedPosition: ViewAsPosition | null;
  isPreviewing: boolean;
  /** Capabilities visible under the current view (all when not previewing). */
  allowed: Set<string>;
  setSelectedPositionId: (id: string | null) => void;
  /** True when `capabilityKey` is visible under the current view. */
  can: (capabilityKey: string | undefined) => boolean;
  refresh: () => Promise<void>;
}

const STORAGE_KEY = 'viewAsPositionId';

// Safe default so consumers rendered outside the provider degrade to "no
// preview, everything visible" instead of crashing.
const DEFAULT_VALUE: ViewAsValue = {
  enabled: false,
  isAdmin: false,
  loading: false,
  positions: [],
  capabilities: ACCESS_CAPABILITIES,
  grants: {},
  selectedPositionId: null,
  selectedPosition: null,
  isPreviewing: false,
  allowed: new Set<string>(ALL_CAPABILITY_KEYS),
  setSelectedPositionId: () => {},
  can: () => true,
  refresh: async () => {},
};

const ViewAsContext = createContext<ViewAsValue>(DEFAULT_VALUE);

export function ViewAsProvider({ children }: { children: React.ReactNode }) {
  const { session } = useSession();

  const [loading, setLoading] = useState(false);
  const [positions, setPositions] = useState<ViewAsPosition[]>([]);
  const [grants, setGrants] = useState<Record<string, string[]>>({});
  const [selectedPositionId, setSelected] = useState<string | null>(null);
  // The real user's effective capabilities. `null` = full access (admin / no
  // position / unconfigured). Stays null until loaded so nothing flickers hidden.
  const [myCaps, setMyCaps] = useState<Set<string> | null>(null);
  // Server-confirmed admin (local_users.role). The JWT role claim can be weaker
  // than the real role, so we trust the server for "can preview / can edit".
  const [serverIsAdmin, setServerIsAdmin] = useState(false);

  // Who may use the "view as" picker: admins (JWT or server-confirmed) + developers.
  const enabled = session?.role === 'admin' || session?.isDeveloper === true || serverIsAdmin;
  // Who may EDIT access (admin only, not dev).
  const isAdmin = serverIsAdmin || session?.role === 'admin';

  // Restore the previewed position once (after mount, to avoid SSR mismatch).
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) setSelected(stored);
    } catch { /* ignore */ }
  }, []);

  // Load the real user's own effective capabilities (everyone, for enforcement).
  useEffect(() => {
    if (!session?.userId) return;
    let mounted = true;
    fetch('/api/positions/my-access', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!mounted || !j) return;
        const d = j.data ?? j;
        setMyCaps(d.capabilities === null || d.capabilities === undefined ? null : new Set<string>(d.capabilities));
        setServerIsAdmin(d.is_admin === true);
      })
      .catch(() => { /* leave full access on failure */ });
    return () => { mounted = false; };
  }, [session?.userId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/positions/access', { credentials: 'include' });
      if (!res.ok) return;
      const json = await res.json();
      const d = json.data ?? json;
      setPositions(d.positions ?? []);
      setGrants(d.grants ?? {});
    } catch { /* offline / unauthorized — leave picker empty */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (enabled) refresh(); }, [enabled, refresh]);

  const setSelectedPositionId = useCallback((id: string | null) => {
    setSelected(id);
    try {
      if (id) window.localStorage.setItem(STORAGE_KEY, id);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
  }, []);

  // A selection only previews while it still maps to a known position.
  const selectedPosition = useMemo(
    () => positions.find((p) => p.id === selectedPositionId) ?? null,
    [positions, selectedPositionId],
  );
  const isPreviewing = enabled && selectedPosition !== null;

  // The effective capability set for what's currently rendered.
  const allowed = useMemo(() => {
    // Previewing a position → exactly that position's grants (unconfigured = none).
    if (isPreviewing && selectedPosition) return capabilitiesForGrant(grants[selectedPosition.id]);
    // The real logged-in user. Admins/developers ALWAYS get full access (safety
    // valve — deny-by-default must never lock them out). Everyone else uses their
    // resolved caps; `null` = full (admin / no position, decided server-side).
    if (enabled) return new Set<string>(ALL_CAPABILITY_KEYS);
    return myCaps === null ? new Set<string>(ALL_CAPABILITY_KEYS) : myCaps;
  }, [isPreviewing, selectedPosition, grants, myCaps, enabled]);

  const can = useCallback(
    (capabilityKey: string | undefined) => {
      if (!capabilityKey) return true;       // unkeyed sections always show
      return allowed.has(capabilityKey);
    },
    [allowed],
  );

  const value = useMemo<ViewAsValue>(() => ({
    enabled,
    isAdmin,
    loading,
    positions,
    capabilities: ACCESS_CAPABILITIES,
    grants,
    selectedPositionId: isPreviewing ? selectedPositionId : null,
    selectedPosition,
    isPreviewing,
    allowed,
    setSelectedPositionId,
    can,
    refresh,
  }), [enabled, isAdmin, loading, positions, grants, selectedPositionId, selectedPosition, isPreviewing, allowed, setSelectedPositionId, can, refresh]);

  return <ViewAsContext.Provider value={value}>{children}</ViewAsContext.Provider>;
}

export function useViewAs(): ViewAsValue {
  return useContext(ViewAsContext);
}
