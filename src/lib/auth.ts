import { cookies } from 'next/headers';

export interface AuthContext {
  userId: string;
  tenantId: string;
  userEmail?: string;
}

type JwtPayload = {
  sub?: string;
  app_metadata?: {
    tenant_id?: string;
    [key: string]: unknown;
  };
  user_metadata?: {
    email?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

function parseJwtPayload(token: string): JwtPayload | null {
  try {
    const payloadSegment = token.split('.')[1];
    if (!payloadSegment) return null;

    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = Buffer.from(padded, 'base64').toString('utf8');

    return JSON.parse(decoded) as JwtPayload;
  } catch {
    return null;
  }
}

/**
 * Get the authentication context from access_token cookie claims.
 * Returns null if not authenticated.
 */
export async function getAuthContext(): Promise<AuthContext | null> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get('access_token')?.value;

  if (!accessToken) {
    return null;
  }

  const payload = parseJwtPayload(accessToken);
  const userId = payload?.sub;
  const tenantId = payload?.app_metadata?.tenant_id;
  const userEmail = payload?.user_metadata?.email;

  if (!userId || !tenantId) {
    return null;
  }

  return { userId, tenantId, userEmail };
}

/**
 * Require authentication - throws error if not authenticated
 * Use this in API routes and server components
 */
export async function requireAuth(): Promise<AuthContext> {
  const auth = await getAuthContext();
  if (!auth) {
    throw new Error('Authentication required');
  }
  return auth;
}

/**
 * Get the current tenant ID - throws error if not authenticated
 * Use this when you only need the tenant ID
 */
export async function getCurrentTenantId(): Promise<string> {
  const auth = await requireAuth();
  return auth.tenantId;
}

/**
 * Get the current user ID - throws error if not authenticated
 * Use this when you only need the user ID
 */
export async function getCurrentUserId(): Promise<string> {
  const auth = await requireAuth();
  return auth.userId;
}

/**
 * Clear authentication cookies (for logout)
 */
export async function clearAuth(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete('access_token');
  cookieStore.delete('refresh_token');
}
