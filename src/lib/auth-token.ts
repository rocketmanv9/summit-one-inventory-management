export type JwtPayload = {
  sub?: string;
  exp?: number;
  app_metadata?: {
    tenant_id?: string;
    tenantId?: string;
    role?: string;
    [key: string]: any;
  };
  user_metadata?: {
    email?: string;
    [key: string]: any;
  };
  [key: string]: any;
};

let cachedAccessToken: string | null = null;
let accessTokenPromise: Promise<string | null> | null = null;
let refreshPromise: Promise<string | null> | null = null;
let refreshTimeoutId: number | null = null;

function clearRefreshTimer(): void {
  if (typeof window === 'undefined') return;
  if (refreshTimeoutId !== null) {
    window.clearTimeout(refreshTimeoutId);
    refreshTimeoutId = null;
  }
}

function scheduleRefreshFromToken(token: string): void {
  if (typeof window === 'undefined') return;

  clearRefreshTimer();

  const expiresAt = getJwtExpiration(token);
  if (!expiresAt) return;

  const refreshAt = expiresAt - 5 * 60 * 1000;
  const delay = Math.max(0, refreshAt - Date.now());

  refreshTimeoutId = window.setTimeout(() => {
    void refreshAccessToken().then((nextToken) => {
      if (nextToken) {
        scheduleRefreshFromToken(nextToken);
        return;
      }

      clearStoredAccessToken();
      redirectToCoreLogin();
    });
  }, delay);
}

async function fetchAccessTokenFromServer(): Promise<string | null> {
  const response = await fetch('/api/auth/token', {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
  }).catch(() => null);

  if (!response?.ok) return null;
  const data = (await response.json()) as { access_token?: string };
  return typeof data.access_token === 'string' ? data.access_token : null;
}

export function getStoredAccessToken(): string | null {
  return cachedAccessToken;
}

export async function loadAccessToken(force = false): Promise<string | null> {
  if (!force && cachedAccessToken) return cachedAccessToken;
  if (typeof window === 'undefined') return null;

  if (!force && accessTokenPromise) {
    return accessTokenPromise;
  }

  accessTokenPromise = fetchAccessTokenFromServer();

  const token = await accessTokenPromise;
  accessTokenPromise = null;

  if (!token) {
    cachedAccessToken = null;
    clearRefreshTimer();
    return null;
  }

  cachedAccessToken = token;
  scheduleRefreshFromToken(token);
  return token;
}

export async function refreshAccessToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  if (refreshPromise) return refreshPromise;

  refreshPromise = fetch('/api/auth/refresh', {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
  })
    .then(async (response) => {
      if (!response.ok) return null;
      return loadAccessToken(true);
    })
    .catch(() => null)
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

export function clearStoredAccessToken(): void {
  cachedAccessToken = null;
  accessTokenPromise = null;
  refreshPromise = null;
  clearRefreshTimer();

  if (typeof window === 'undefined') return;
  fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
}

export function parseJwtPayload(token: string): JwtPayload | null {
  try {
    const payloadSegment = token.split('.')[1];
    if (!payloadSegment) return null;

    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = atob(padded);

    return JSON.parse(decoded) as JwtPayload;
  } catch {
    return null;
  }
}

export function getJwtExpiration(token: string): number | null {
  const payload = parseJwtPayload(token);
  if (!payload?.exp) return null;
  return payload.exp * 1000;
}

export function isJwtExpired(token: string, skewSeconds = 30): boolean {
  const expiresAt = getJwtExpiration(token);
  if (!expiresAt) return false;
  return Date.now() >= expiresAt - skewSeconds * 1000;
}

export function redirectToCoreLogin(): void {
  if (typeof window === 'undefined') return;
  const coreUrl = process.env.NEXT_PUBLIC_CORE_APP_URL || 'https://dev.summit-one.app';
  window.location.href = `${coreUrl}/login`;
}

export function handleSupabaseAuthError(error: { message?: string; status?: number; code?: string } | null) {
  if (!error) return;

  const message = error.message?.toLowerCase() || '';
  const isAuthError =
    message.includes('jwt expired') ||
    message.includes('invalid jwt') ||
    error.status === 401 ||
    error.status === 403;

  if (isAuthError) {
    void refreshAccessToken().then((token) => {
      if (token) return;
      clearStoredAccessToken();
      redirectToCoreLogin();
    });
  }
}

export function getTenantIdFromToken(token: string): string | null {
  const payload = parseJwtPayload(token);
  return payload?.app_metadata?.tenant_id || payload?.app_metadata?.tenantId || null;
}

export function getUserIdFromToken(token: string): string | null {
  const payload = parseJwtPayload(token);
  return payload?.sub || null;
}
