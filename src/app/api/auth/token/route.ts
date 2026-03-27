import { createReadRoute } from '@rocketmanv9/chassis/nextjs';
import { cookies } from 'next/headers';
import { ACCESS_TOKEN_COOKIE } from '@rocketmanv9/chassis/auth';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/**
 * GET /api/auth/token — returns the access token from the httpOnly cookie.
 *
 * Client-side code calls this to get the token for API requests.
 */
export const GET = createReadRoute(async ({ req, session }) => {
  const cookieStore = await cookies();
  const token = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;

  if (!token) {
    throw AppError.unauthorized('No session');
  }

  return Response.json({ access_token: token });
}, { serviceName: SERVICE_NAME, auth: 'session' });
