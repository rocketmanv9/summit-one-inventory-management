export type JwtPayload = {
  sub?: string;
  exp?: number;
  app_metadata?: {
    tenant_id?: string;
    tenantId?: string;
    role?: string;
    [key: string]: any;
  };
  [key: string]: any;
};

export function getStoredAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('custom_access_token');
}

export function clearStoredAccessToken(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('custom_access_token');
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
    clearStoredAccessToken();
    redirectToCoreLogin();
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
