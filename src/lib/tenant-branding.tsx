'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { getAuthToken, getTenantIdFromToken } from '@/lib/auth-token';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TenantBranding {
  // Core palette
  primary_color: string;
  primary_foreground: string;
  secondary_color: string;
  secondary_foreground: string;
  accent_color: string;
  accent_foreground: string;
  muted_color: string;
  muted_foreground: string;
  destructive_color: string;
  destructive_foreground: string;
  success_color: string;
  success_foreground: string;
  warning_color: string;
  warning_foreground: string;

  // Surface
  background_color: string;
  foreground_color: string;
  card_color: string;
  card_foreground: string;
  popover_color: string;
  popover_foreground: string;

  // Borders & inputs
  border_color: string;
  input_color: string;
  ring_color: string;

  // Sidebar
  sidebar_background: string;
  sidebar_foreground: string;
  sidebar_border: string;
  sidebar_accent: string;
  sidebar_accent_foreground: string;

  // Charts
  chart_1: string;
  chart_2: string;
  chart_3: string;
  chart_4: string;
  chart_5: string;

  // Fonts
  font_family_title: string;
  font_family_body: string;

  // Gradients
  gradient_start: string;
  gradient_end: string;
  gradient_angle: string;

  // Logo
  logo_url: string;
  logo_mark_url: string;

  // Misc
  radius: string;
}

// ---------------------------------------------------------------------------
// Fallback branding (matches globals.css defaults)
// ---------------------------------------------------------------------------

const fallbackBranding: TenantBranding = {
  primary_color: '#3b82f6',
  primary_foreground: '#f8fafc',
  secondary_color: '#f1f5f9',
  secondary_foreground: '#1e293b',
  accent_color: '#8b5cf6',
  accent_foreground: '#f8fafc',
  muted_color: '#f1f5f9',
  muted_foreground: '#64748b',
  destructive_color: '#ef4444',
  destructive_foreground: '#f8fafc',
  success_color: '#16a34a',
  success_foreground: '#f8fafc',
  warning_color: '#f59e0b',
  warning_foreground: '#f8fafc',

  background_color: '#ffffff',
  foreground_color: '#0f172a',
  card_color: '#ffffff',
  card_foreground: '#0f172a',
  popover_color: '#ffffff',
  popover_foreground: '#0f172a',

  border_color: '#e2e8f0',
  input_color: '#e2e8f0',
  ring_color: '#3b82f6',

  sidebar_background: '#1e1b2e',
  sidebar_foreground: '#f1f5f9',
  sidebar_border: '#2d2a3e',
  sidebar_accent: '#2d2a3e',
  sidebar_accent_foreground: '#f1f5f9',

  chart_1: '#3b82f6',
  chart_2: '#8b5cf6',
  chart_3: '#16a34a',
  chart_4: '#f59e0b',
  chart_5: '#ef4444',

  font_family_title: '',
  font_family_body: '',

  gradient_start: '#3b82f6',
  gradient_end: '#8b5cf6',
  gradient_angle: '135',

  logo_url: '',
  logo_mark_url: '',

  radius: '0.5rem',
};

// ---------------------------------------------------------------------------
// Hex → HSL conversion
// ---------------------------------------------------------------------------

function hexToHsl(hex: string): string {
  const cleaned = hex.replace('#', '');
  const r = parseInt(cleaned.substring(0, 2), 16) / 255;
  const g = parseInt(cleaned.substring(2, 4), 16) / 255;
  const b = parseInt(cleaned.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
    return `0 0% ${Math.round(l * 100)}%`;
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function isValidHex(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

// ---------------------------------------------------------------------------
// CSS variable application
// ---------------------------------------------------------------------------

const CSS_VAR_MAP: Record<string, keyof TenantBranding> = {
  '--primary': 'primary_color',
  '--primary-foreground': 'primary_foreground',
  '--secondary': 'secondary_color',
  '--secondary-foreground': 'secondary_foreground',
  '--accent': 'accent_color',
  '--accent-foreground': 'accent_foreground',
  '--muted': 'muted_color',
  '--muted-foreground': 'muted_foreground',
  '--destructive': 'destructive_color',
  '--destructive-foreground': 'destructive_foreground',
  '--success': 'success_color',
  '--success-foreground': 'success_foreground',
  '--warning': 'warning_color',
  '--warning-foreground': 'warning_foreground',
  '--background': 'background_color',
  '--foreground': 'foreground_color',
  '--card': 'card_color',
  '--card-foreground': 'card_foreground',
  '--popover': 'popover_color',
  '--popover-foreground': 'popover_foreground',
  '--border': 'border_color',
  '--input': 'input_color',
  '--ring': 'ring_color',
  '--sidebar-background': 'sidebar_background',
  '--sidebar-foreground': 'sidebar_foreground',
  '--sidebar-border': 'sidebar_border',
  '--sidebar-accent': 'sidebar_accent',
  '--sidebar-accent-foreground': 'sidebar_accent_foreground',
  '--chart-1': 'chart_1',
  '--chart-2': 'chart_2',
  '--chart-3': 'chart_3',
  '--chart-4': 'chart_4',
  '--chart-5': 'chart_5',
};

function applyCssVariables(branding: TenantBranding) {
  const root = document.documentElement;

  // Apply HSL-converted color vars (for tailwind classes like bg-primary)
  for (const [cssVar, brandingKey] of Object.entries(CSS_VAR_MAP)) {
    const value = branding[brandingKey];
    if (typeof value === 'string' && isValidHex(value)) {
      root.style.setProperty(cssVar, hexToHsl(value));
      // Also set raw hex var for components that need it
      root.style.setProperty(`${cssVar}-hex`, value);
    }
  }

  // Fonts
  if (branding.font_family_title) {
    root.style.setProperty('--font-family-title', branding.font_family_title);
  }
  if (branding.font_family_body) {
    root.style.setProperty('--font-family-body', branding.font_family_body);
  }

  // Gradient
  if (isValidHex(branding.gradient_start) && isValidHex(branding.gradient_end)) {
    root.style.setProperty('--gradient-start', branding.gradient_start);
    root.style.setProperty('--gradient-end', branding.gradient_end);
    root.style.setProperty('--gradient-angle', `${branding.gradient_angle || '135'}deg`);
  }

  // Radius
  if (branding.radius) {
    root.style.setProperty('--radius', branding.radius);
  }
}

// ---------------------------------------------------------------------------
// Core RPC fetch (PostgREST REST endpoint — avoids @supabase/supabase-js import)
// ---------------------------------------------------------------------------

async function fetchBrandingFromCore(tenantId: string): Promise<TenantBranding | null> {
  const coreUrl = process.env.NEXT_PUBLIC_CORE_SUPABASE_URL;
  const coreKey = process.env.NEXT_PUBLIC_CORE_SUPABASE_ANON_KEY;

  if (!coreUrl || !coreKey) {
    console.warn('[Branding] Missing NEXT_PUBLIC_CORE_SUPABASE_URL or NEXT_PUBLIC_CORE_SUPABASE_ANON_KEY');
    return null;
  }

  try {
    const res = await fetch(`${coreUrl}/rest/v1/rpc/get_public_branding`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: coreKey,
        Authorization: `Bearer ${coreKey}`,
      },
      body: JSON.stringify({ target_tenant_id: tenantId }),
    });

    if (!res.ok) {
      console.warn(`[Branding] Core RPC returned ${res.status}`);
      return null;
    }

    const data = await res.json();
    if (!data || typeof data !== 'object') return null;

    // Merge with fallback so all keys are present
    return { ...fallbackBranding, ...data } as TenantBranding;
  } catch (err) {
    console.warn('[Branding] Failed to fetch from Core:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// localStorage cache helpers
// ---------------------------------------------------------------------------

function getCachedBranding(tenantId: string): TenantBranding | null {
  try {
    const raw = localStorage.getItem(`branding_${tenantId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Check cache age — expire after 5 minutes (polling will refresh sooner)
    if (parsed._cachedAt && Date.now() - parsed._cachedAt > 5 * 60 * 1000) {
      return null;
    }
    return { ...fallbackBranding, ...parsed } as TenantBranding;
  } catch {
    return null;
  }
}

function setCachedBranding(tenantId: string, branding: TenantBranding) {
  try {
    localStorage.setItem(
      `branding_${tenantId}`,
      JSON.stringify({ ...branding, _cachedAt: Date.now() })
    );
  } catch {
    // localStorage full or unavailable — non-critical
  }
}

// ---------------------------------------------------------------------------
// React Context
// ---------------------------------------------------------------------------

interface TenantBrandingContextValue {
  branding: TenantBranding;
  isLoaded: boolean;
  tenantId: string | null;
}

const TenantBrandingContext = createContext<TenantBrandingContextValue>({
  branding: fallbackBranding,
  isLoaded: false,
  tenantId: null,
});

export function useTenantBranding() {
  return useContext(TenantBrandingContext);
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 60_000; // 60 seconds

export function TenantBrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<TenantBranding>(fallbackBranding);
  const [isLoaded, setIsLoaded] = useState(false);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    async function loadBranding() {
      // 1. Get tenant ID from JWT
      const token = await getAuthToken();
      if (!token) return;

      const tid = getTenantIdFromToken(token);
      if (!tid) return;

      if (mountedRef.current) setTenantId(tid);

      // 2. Check localStorage cache first (instant paint)
      const cached = getCachedBranding(tid);
      if (cached) {
        if (mountedRef.current) {
          setBranding(cached);
          setIsLoaded(true);
          applyCssVariables(cached);
          console.log(`[Branding] Applied cached branding for tenant=${tid}`);
        }
      }

      // 3. Fetch fresh from Core
      const fresh = await fetchBrandingFromCore(tid);
      if (fresh && mountedRef.current) {
        setBranding(fresh);
        setIsLoaded(true);
        applyCssVariables(fresh);
        setCachedBranding(tid, fresh);
        console.log(`[Branding] Applied tenant=${tid} branding from Core`);
      } else if (!cached && mountedRef.current) {
        // No cache, no fetch — use fallback
        setIsLoaded(true);
      }
    }

    loadBranding();

    // 4. Poll every 60s for branding updates
    pollRef.current = setInterval(async () => {
      if (document.hidden) return; // Skip if tab is in background
      const token = await getAuthToken();
      if (!token) return;
      const tid = getTenantIdFromToken(token);
      if (!tid) return;

      const fresh = await fetchBrandingFromCore(tid);
      if (fresh && mountedRef.current) {
        setBranding(fresh);
        applyCssVariables(fresh);
        setCachedBranding(tid, fresh);
      }
    }, POLL_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  // 5. Pause polling when tab is hidden, resume when visible
  useEffect(() => {
    function handleVisibility() {
      if (document.hidden && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      } else if (!document.hidden && !pollRef.current) {
        // Immediately fetch on return, then resume polling
        (async () => {
          const token = await getAuthToken();
          if (!token) return;
          const tid = getTenantIdFromToken(token);
          if (!tid) return;
          const fresh = await fetchBrandingFromCore(tid);
          if (fresh && mountedRef.current) {
            setBranding(fresh);
            applyCssVariables(fresh);
            setCachedBranding(tid, fresh);
          }
        })();

        pollRef.current = setInterval(async () => {
          if (document.hidden) return;
          const token = await getAuthToken();
          if (!token) return;
          const tid = getTenantIdFromToken(token);
          if (!tid) return;
          const fresh = await fetchBrandingFromCore(tid);
          if (fresh && mountedRef.current) {
            setBranding(fresh);
            applyCssVariables(fresh);
            setCachedBranding(tid, fresh);
          }
        }, POLL_INTERVAL_MS);
      }
    }

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  return (
    <TenantBrandingContext.Provider value={{ branding, isLoaded, tenantId }}>
      {children}
    </TenantBrandingContext.Provider>
  );
}
