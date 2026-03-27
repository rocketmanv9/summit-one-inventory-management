import { cookies } from 'next/headers';
import {
  verifySessionToken,
  ACCESS_TOKEN_COOKIE,
  type SessionAccessClaims,
} from '@rocketmanv9/chassis/auth';
import { AppError } from '@rocketmanv9/chassis/errors';

export type AuthContext = {
  userId: string;
  email: string;
  tenantId: string;
  name: string;
  role: string;
  isDeveloper: boolean;
};

/**
 * Verifies the session access token from the httpOnly cookie
 * (signed with SUPABASE_JWT_SECRET) and extracts user + tenant context.
 *
 * Throws if no tenant is present (all Summit services require tenant context).
 * Use this at the top of any authenticated route handler.
 */
export async function requireAuthContext(): Promise<AuthContext> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;

  if (!token) {
    throw AppError.unauthorized('Not authenticated');
  }

  let claims: SessionAccessClaims;
  try {
    claims = await verifySessionToken(token);
  } catch {
    throw AppError.unauthorized('Invalid or expired session');
  }

  const tenantId = claims.app_metadata?.tenant_id;
  if (!tenantId) {
    throw AppError.forbidden('No tenant context found');
  }

  return {
    userId: claims.sub,
    email: claims.email,
    tenantId,
    name: claims.user_metadata?.full_name ?? '',
    role: claims.app_metadata?.role ?? 'authenticated',
    isDeveloper: claims.app_metadata?.is_developer === true,
  };
}
