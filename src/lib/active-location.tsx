'use client';

// ---------------------------------------------------------------------------
// Active location context — "which yard am I looking at?"
//
// A single, app-wide answer to that question, remembered in localStorage and
// surfaced loudly in the top nav. Pages default their per-page location handling
// to this so the data on screen always belongs to a known yard.
//
//  - `activeLocationId` is a real location UUID, or `'all'` for tenant-wide.
//  - `'all'` is the safe default: pages behave exactly as they did before this
//    context existed (no scoping), so nothing regresses.
//  - This is *context*, not access control — ViewAs handles permission scoping.
//    Changing the active location never grants or revokes anything; it only
//    changes what a page defaults to showing.
//
// Modeled on `src/lib/view-as.tsx` (localStorage + React context + a safe
// default so consumers outside the provider degrade gracefully).
// ---------------------------------------------------------------------------

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authenticatedFetch } from '@/lib/api-client';

export const ALL_LOCATIONS = 'all' as const;
export type ActiveLocationId = string; // a location UUID or ALL_LOCATIONS

export interface ActiveLocationOption {
  id: string;
  name: string;
  location_type_name?: string | null;
}

interface ActiveLocationValue {
  /** Current selection: a location UUID or `'all'`. */
  activeLocationId: ActiveLocationId;
  /** The resolved active location row, or null when `'all'` (or still loading). */
  activeLocation: ActiveLocationOption | null;
  /** True when a specific location (not `'all'`) is active. */
  isScoped: boolean;
  /** All active locations for the tenant (for the picker + page dropdowns). */
  locations: ActiveLocationOption[];
  loading: boolean;
  setActiveLocationId: (id: ActiveLocationId) => void;
  /**
   * The location a page should default to, or `undefined` when `'all'` is
   * active (= no default, show everything). Handy sugar so pages read one thing.
   */
  defaultLocationId: string | undefined;
}

const STORAGE_KEY = 'activeLocationId';

const DEFAULT_VALUE: ActiveLocationValue = {
  activeLocationId: ALL_LOCATIONS,
  activeLocation: null,
  isScoped: false,
  locations: [],
  loading: false,
  setActiveLocationId: () => {},
  defaultLocationId: undefined,
};

const ActiveLocationContext = createContext<ActiveLocationValue>(DEFAULT_VALUE);

export function ActiveLocationProvider({ children }: { children: React.ReactNode }) {
  const [activeLocationId, setActive] = useState<ActiveLocationId>(ALL_LOCATIONS);
  const [locations, setLocations] = useState<ActiveLocationOption[]>([]);
  const [loading, setLoading] = useState(true);

  // Restore the remembered selection once, after mount, to avoid SSR mismatch.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) setActive(stored);
    } catch {
      /* ignore */
    }
  }, []);

  // Load the tenant's active locations for the picker via the session-
  // authenticated API route — the app's blessed path for inventory-schema
  // reads (direct client queries against the inventory schema are denied in the
  // browser). Retries briefly so a not-yet-loaded auth token on first mount
  // doesn't leave the picker empty.
  useEffect(() => {
    let mounted = true;
    (async () => {
      for (let attempt = 0; attempt < 4 && mounted; attempt++) {
        try {
          const res = await authenticatedFetch('/api/inventory/locations');
          if (res.ok) {
            const { data } = await res.json();
            if (!mounted) return;
            setLocations(
              (data || []).map((l: any) => ({
                id: l.id,
                name: l.name,
                location_type_name: l.location_type?.name ?? null,
              })),
            );
            break;
          }
        } catch {
          /* transient (e.g. token not ready) — retry below */
        }
        await new Promise((r) => setTimeout(r, 400));
      }
      if (mounted) setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const setActiveLocationId = useCallback((id: ActiveLocationId) => {
    setActive(id || ALL_LOCATIONS);
    try {
      if (id && id !== ALL_LOCATIONS) window.localStorage.setItem(STORAGE_KEY, id);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const activeLocation = useMemo(
    () => (activeLocationId === ALL_LOCATIONS ? null : locations.find((l) => l.id === activeLocationId) ?? null),
    [activeLocationId, locations],
  );

  // A non-'all' selection scopes the app. We honor the stored id even when the
  // locations list is still loading OR failed to load (empty) — that way pages
  // don't flash tenant-wide, and a transient locations-fetch failure never
  // silently drops the user's chosen yard. We only *demote* to All locations
  // when the list loaded successfully AND the id is genuinely gone from it.
  const knownGone = !loading && locations.length > 0 && activeLocation === null;
  const isScoped = activeLocationId !== ALL_LOCATIONS && !knownGone;
  const defaultLocationId = isScoped ? activeLocationId : undefined;

  const value = useMemo<ActiveLocationValue>(
    () => ({
      activeLocationId: isScoped ? activeLocationId : ALL_LOCATIONS,
      activeLocation,
      isScoped,
      locations,
      loading,
      setActiveLocationId,
      defaultLocationId,
    }),
    [activeLocationId, activeLocation, isScoped, locations, loading, setActiveLocationId, defaultLocationId],
  );

  return <ActiveLocationContext.Provider value={value}>{children}</ActiveLocationContext.Provider>;
}

export function useActiveLocation(): ActiveLocationValue {
  return useContext(ActiveLocationContext);
}
