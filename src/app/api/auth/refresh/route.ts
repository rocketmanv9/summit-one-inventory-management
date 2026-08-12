import { createReadRoute } from '@rocketmanv9/chassis/nextjs';
import { cookies } from 'next/headers';
import {
  verifyRefreshToken,
  mintSessionTokens,
  accessTokenCookieConfig,
  refreshTokenCookieConfig,
  REFRESH_TOKEN_COOKIE,
  type SessionUserInfo,
} from '@rocketmanv9/chassis/auth';
import { AppError } from '@rocketmanv9/chassis/errors';
import { provisionAndEnrichLocalUser } from '@/lib/auth/provision-local-user';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/**
 * POST /api/auth/refresh — verify the refresh token and mint a fresh pair.
 *
 * The refresh token includes full user claims (app_metadata, user_metadata),
 * so no need to read the expired access token.
 */
export const POST = createReadRoute(async ({ req }) => {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get(REFRESH_TOKEN_COOKIE)?.value;

  if (!refreshToken) {
    throw AppError.unauthorized('No refresh token');
  }

  try {
    // Verify the refresh token — contains full user claims
    const claims = await verifyRefreshToken(refreshToken);

    // Build user info from refresh token claims, then enrich role from local_users
    let user: SessionUserInfo = {
      userId: claims.sub,
      tenantId: claims.app_metadata?.tenant_id ?? null,
      email: claims.user_metadata?.email ?? claims.email ?? '',
      name: claims.user_metadata?.full_name ?? '',
      role: claims.app_metadata?.role ?? 'authenticated',
      isDeveloper: claims.app_metadata?.is_developer === true,
    };
    user = await provisionAndEnrichLocalUser(user);

    const { accessToken: newAccess, refreshToken: newRefresh } = await mintSessionTokens(user);

    const accessCfg = accessTokenCookieConfig(newAccess);
    const refreshCfg = refreshTokenCookieConfig(newRefresh);

    cookieStore.set(accessCfg.name, accessCfg.value, accessCfg);
    cookieStore.set(refreshCfg.name, refreshCfg.value, refreshCfg);

    return Response.json({ refreshed: true });
  } catch {
    throw AppError.unauthorized('Invalid refresh token');
  }
}, { serviceName: SERVICE_NAME, auth: 'public' });
