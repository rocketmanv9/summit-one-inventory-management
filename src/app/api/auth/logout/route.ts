import { createReadRoute } from '@rocketmanv9/chassis/nextjs';
import { cookies } from 'next/headers';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from '@rocketmanv9/chassis/auth';
import { loadConfig } from '@rocketmanv9/chassis/config';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/**
 * GET|POST /api/auth/logout — clear session cookies and return Core login URL.
 */
const handler = createReadRoute(async ({ req }) => {
  const cookieStore = await cookies();
  const config = loadConfig();

  // Clear both session cookies
  cookieStore.set(ACCESS_TOKEN_COOKIE, '', { maxAge: 0, path: '/' });
  cookieStore.set(REFRESH_TOKEN_COOKIE, '', { maxAge: 0, path: '/' });

  return Response.json({
    loggedOut: true,
    redirectTo: config.NEXT_PUBLIC_CORE_APP_URL,
  });
}, { serviceName: SERVICE_NAME, auth: 'public' });

export const GET = handler;
export const POST = handler;
