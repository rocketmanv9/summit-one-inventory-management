/**
 * Client-side auth token manager.
 *
 * Caches the access token in memory and auto-refreshes 5 minutes before expiry.
 * Usage: const token = await getAuthToken();
 */

let cachedToken: string | null = null;
let expiresAt = 0;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let eagerLoadStarted = false;

/** Margin before expiry to trigger refresh (5 minutes). */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * Returns a valid access token, fetching or refreshing as needed.
 */
export async function getAuthToken(): Promise<string | null> {
  if (cachedToken && Date.now() < expiresAt - REFRESH_MARGIN_MS) {
    return cachedToken;
  }

  return fetchToken();
}

async function fetchToken(): Promise<string | null> {
  try {
    const res = await fetch('/api/auth/token', { credentials: 'include' });

    if (!res.ok) {
      clearCache();
      return null;
    }

    const { access_token } = await res.json();
    if (!access_token) {
      clearCache();
      return null;
    }

    // Decode exp from JWT payload (middle segment)
    const payload = JSON.parse(atob(access_token.split('.')[1]));
    const expMs = payload.exp * 1000;

    cachedToken = access_token;
    expiresAt = expMs;

    // Schedule auto-refresh 5 minutes before expiry
    scheduleRefresh(expMs);

    return cachedToken;
  } catch {
    clearCache();
    return null;
  }
}

function scheduleRefresh(expMs: number) {
  if (refreshTimer) clearTimeout(refreshTimer);

  const refreshAt = expMs - REFRESH_MARGIN_MS - Date.now();
  if (refreshAt <= 0) return;

  refreshTimer = setTimeout(async () => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });

      if (res.ok) {
        await fetchToken(); // Re-fetch the new access token
      } else {
        clearCache();
      }
    } catch {
      clearCache();
    }
  }, refreshAt);
}

function clearCache() {
  cachedToken = null;
  expiresAt = 0;
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

/**
 * Force-clear the cached token (call on logout).
 */
export function clearAuthToken() {
  clearCache();
}

// ---------------------------------------------------------------------------
// Compatibility wrappers — these names are used by consumer files
// (supabase/client.ts, api-client.ts, RPC layer, dashboard pages, etc.)
// ---------------------------------------------------------------------------

/** Async load — alias for getAuthToken(). */
export const loadAccessToken = getAuthToken;

/** Synchronous read of the in-memory cached token (may be null). */
export function getStoredAccessToken(): string | null {
  return cachedToken;
}

/** Trigger a refresh via the /api/auth/refresh endpoint, return the new token. */
export async function refreshAccessToken(): Promise<string | null> {
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) {
      clearCache();
      return null;
    }
    return fetchToken();
  } catch {
    clearCache();
    return null;
  }
}

/** Clear the cached token — alias for clearAuthToken(). */
export const clearStoredAccessToken = clearAuthToken;

// Warm the in-memory cache as soon as this module loads in the browser.
// Several RPC helpers read the cache synchronously (getStoredAccessToken) and
// would otherwise race the first async hydration on a hard page refresh.
if (typeof window !== 'undefined' && !eagerLoadStarted) {
  eagerLoadStarted = true;
  void getAuthToken();
}

/** Redirect to the Core login page. */
export function redirectToCoreLogin(): void {
  if (typeof window === 'undefined') return;
  const coreUrl =
    (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_CORE_APP_URL) ||
    '/';
  window.location.href = coreUrl;
}

/** Decode the payload (middle segment) of a JWT. */
export function parseJwtPayload(token: string): Record<string, any> {
  try {
    return JSON.parse(atob(token.split('.')[1]));
  } catch {
    return {};
  }
}

/** Returns true when the token's `exp` claim is in the past. */
export function isJwtExpired(token: string): boolean {
  const payload = parseJwtPayload(token);
  if (!payload.exp) return true;
  return Date.now() >= payload.exp * 1000;
}

/** Extract tenant_id from the JWT's app_metadata. */
export function getTenantIdFromToken(token: string): string | null {
  const payload = parseJwtPayload(token);
  return payload.app_metadata?.tenant_id ?? null;
}

/** Extract the user id (sub claim) from the JWT. */
export function getUserIdFromToken(token: string): string | null {
  const payload = parseJwtPayload(token);
  return payload.sub ?? null;
}

/** Handle a Supabase auth error — clear token and redirect on 401/403. */
export function handleSupabaseAuthError(error: any): boolean {
  if (!error) return false;
  const status = typeof error.status === 'number' ? error.status : null;
  const code = typeof error.code === 'string' ? error.code : '';
  const message = String(error.message || '').toLowerCase();

  const isAuth =
    status === 401 ||
    status === 403 ||
    code === 'PGRST301' ||
    message.includes('jwt') ||
    message.includes('unauthorized') ||
    message.includes('invalid token') ||
    message.includes('not authenticated');

  if (isAuth) {
    clearCache();
    redirectToCoreLogin();
  }
  return isAuth;
}
