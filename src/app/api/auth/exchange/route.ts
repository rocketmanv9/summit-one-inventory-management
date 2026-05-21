import { createReadRoute } from '@rocketmanv9/chassis/nextjs';
import { cookies } from 'next/headers';
import {
  exchangeTicketWithCore,
  mintSessionTokens,
  accessTokenCookieConfig,
  refreshTokenCookieConfig,
  type SessionUserInfo,
} from '@rocketmanv9/chassis/auth';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { getAdminClient } from '@/utils/supabase/admin';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const ExchangeSchema = z.object({
  ticket: z.string().min(1),
});

/**
 * Enrich user role from local_users table.
 * If the user has 'admin' in local_users, override the role from Core.
 * This ensures local admin assignments survive Core migrations.
 */
async function enrichRoleFromLocalUsers(user: SessionUserInfo): Promise<SessionUserInfo> {
  try {
    const admin = getAdminClient();
    const { data } = await admin
      .from('local_users')
      .select('role')
      .eq('user_id', user.userId)
      .eq('tenant_id', user.tenantId)
      .single();

    if (data?.role === 'admin') {
      return { ...user, role: 'admin' };
    }
  } catch {
    // local_users table may not exist yet — fall through to Core role
  }
  return user;
}

/**
 * POST /api/auth/exchange — exchange a one-time ticket for session tokens.
 *
 * Supports:
 * - Real tickets: forwarded to Core for validation
 * - Dev ticket (ticket_dev_local): mints a local dev session (non-production only)
 */
export const POST = createReadRoute(async ({ req }) => {
  const body = ExchangeSchema.parse(await req.json());

  let user: SessionUserInfo;

  if (body.ticket === 'ticket_dev_local') {
    if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_DEV_LOGIN) {
      throw AppError.forbidden('Dev login not available in production');
    }

    user = {
      userId: '00000000-0000-0000-0000-000000000001',
      tenantId: process.env.DEV_TENANT_ID || '052abee2-ffdc-470e-975a-b917dde72b8e',
      email: 'dev@test.com',
      name: 'Dev User',
      role: 'admin',
      isDeveloper: true,
    };
  } else {
    user = await exchangeTicketWithCore({
      ticket: body.ticket,
      targetService: process.env.INTERNAL_JWT_ISSUER || undefined,
      forwardHeaders: {
        'x-forwarded-for': req.headers.get('x-forwarded-for') || 'unknown',
        'user-agent': req.headers.get('user-agent') || 'unknown',
      },
    });

    // Enrich role from local_users — local admin assignments take precedence over Core
    user = await enrichRoleFromLocalUsers(user);
  }

  const { accessToken, refreshToken } = await mintSessionTokens(user);

  const cookieStore = await cookies();
  const accessCfg = accessTokenCookieConfig(accessToken);
  const refreshCfg = refreshTokenCookieConfig(refreshToken);

  cookieStore.set(accessCfg.name, accessCfg.value, accessCfg);
  cookieStore.set(refreshCfg.name, refreshCfg.value, refreshCfg);

  return Response.json({ access_token: accessToken, refresh_token: refreshToken });
}, { serviceName: SERVICE_NAME, auth: 'public' });
