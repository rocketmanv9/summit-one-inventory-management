import { createReadRoute } from '@rocketmanv9/chassis/nextjs';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  exchangeTicketWithCore,
  mintSessionTokens,
  accessTokenCookieConfig,
  refreshTokenCookieConfig,
} from '@rocketmanv9/chassis/auth';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/**
 * SSO callback — Core redirects here with a one-time ticket.
 *
 * Flow: Core -> /auth/callback?ticket=XXX -> exchange ticket -> mint JWTs -> set cookies -> /dashboard
 */
export const GET = createReadRoute(async ({ req }) => {
  const { searchParams } = new URL(req.url);
  const ticket = searchParams.get('ticket');
  const targetOrg = searchParams.get('target_org');
  const targetService = searchParams.get('target_service');

  if (!ticket) {
    return NextResponse.redirect(new URL('/error?code=missing_ticket', req.url));
  }

  try {
    // 1. Exchange ticket with Core for user identity
    const user = await exchangeTicketWithCore({
      ticket,
      targetOrg,
      targetService: targetService || process.env.INTERNAL_JWT_ISSUER || undefined,
      forwardHeaders: {
        'x-forwarded-for': req.headers.get('x-forwarded-for') || 'unknown',
        'user-agent': req.headers.get('user-agent') || 'unknown',
      },
    });

    // 2. Mint access + refresh tokens signed with SUPABASE_JWT_SECRET
    const { accessToken, refreshToken } = await mintSessionTokens(user);

    // 3. Set httpOnly cookies
    const cookieStore = await cookies();
    const accessCfg = accessTokenCookieConfig(accessToken);
    const refreshCfg = refreshTokenCookieConfig(refreshToken);

    cookieStore.set(accessCfg.name, accessCfg.value, accessCfg);
    cookieStore.set(refreshCfg.name, refreshCfg.value, refreshCfg);

    // 4. Redirect to dashboard
    return NextResponse.redirect(new URL('/dashboard', req.url));
  } catch (error) {
    console.error('[Auth Callback] Exchange failed:', error);
    return NextResponse.redirect(new URL('/error?code=exchange_failed', req.url));
  }
}, { serviceName: SERVICE_NAME, auth: 'public' });
