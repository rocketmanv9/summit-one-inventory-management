import { cookies } from 'next/headers';
import {
  verifySessionToken,
  ACCESS_TOKEN_COOKIE,
} from '@rocketmanv9/chassis/auth';
import { AppError } from '@rocketmanv9/chassis/errors';

export type Session = {
  userId: string;
  tenantId: string | null;
  email: string;
  name: string;
  role: string;
  isDeveloper: boolean;
};

/**
 * Reads the SSO session by verifying the access token from the httpOnly cookie.
 * Returns null if no valid session exists.
 *
 * WARNING: tenantId may be null. For routes that require tenant context,
 * use requireAuthContext() from @/lib/auth instead.
 */
export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;

  if (!token) return null;

  try {
    const claims = await verifySessionToken(token);
    return {
      userId: claims.sub,
      tenantId: claims.app_metadata?.tenant_id ?? null,
      email: claims.email,
      name: claims.user_metadata?.full_name ?? '',
      role: claims.app_metadata?.role ?? 'authenticated',
      isDeveloper: claims.app_metadata?.is_developer === true,
    };
  } catch {
    return null;
  }
}

/**
 * Requires a valid SSO session or throws.
 * Use at the top of server components and route handlers.
 *
 * NOTE: This only checks authentication, not tenant context.
 * For routes that require both auth + tenant, use requireAuthContext()
 * from @/lib/auth which guarantees a non-null tenantId.
 */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) {
    throw AppError.unauthorized('Not authenticated');
  }
  return session;
}
