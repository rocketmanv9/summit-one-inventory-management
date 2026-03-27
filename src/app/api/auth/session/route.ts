import { createReadRoute } from '@rocketmanv9/chassis/nextjs';
import { cookies } from 'next/headers';
import {
  verifySessionToken,
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from '@rocketmanv9/chassis/auth';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/**
 * GET /api/auth/session — return the current user context from the access token.
 */
export const GET = createReadRoute(async ({ req, session }) => {
  const cookieStore = await cookies();
  const token = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;

  if (!token) {
    throw AppError.unauthorized('Not authenticated');
  }

  try {
    const claims = await verifySessionToken(token);

    return Response.json({
      authenticated: true,
      userId: claims.sub,
      email: claims.email,
      tenantId: claims.app_metadata?.tenant_id ?? null,
      name: claims.user_metadata?.full_name ?? '',
      role: claims.app_metadata?.role ?? 'authenticated',
      isDeveloper: claims.app_metadata?.is_developer === true,
    });
  } catch {
    throw AppError.unauthorized('Not authenticated');
  }
}, { serviceName: SERVICE_NAME, auth: 'session' });

/**
 * DELETE /api/auth/session — clear the session (alias for logout).
 */
export const DELETE = createReadRoute(async ({ req }) => {
  const cookieStore = await cookies();
  cookieStore.set(ACCESS_TOKEN_COOKIE, '', { maxAge: 0, path: '/' });
  cookieStore.set(REFRESH_TOKEN_COOKIE, '', { maxAge: 0, path: '/' });

  return Response.json({ cleared: true });
}, { serviceName: SERVICE_NAME, auth: 'public' });
