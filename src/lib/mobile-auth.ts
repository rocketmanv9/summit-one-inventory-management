import { SignJWT, jwtVerify } from 'jose';
import { AppError } from '@rocketmanv9/chassis/errors';

const ISSUER = 'mobile-count';
const AUDIENCE = 'summit-inventory';
const JWT_TTL_SECONDS = 15 * 60; // 15 minutes

interface MobileJwtPayload {
  sessionId: string;
  tenantId: string;
  cycleCountId: string;
  userId: string;
}

interface MobileSession {
  sessionId: string;
  tenantId: string;
  cycleCountId: string;
  userId: string;
}

function getSecret(): Uint8Array {
  const secret = process.env.INTERNAL_JWT_SECRET;
  if (!secret) {
    throw AppError.internal('INTERNAL_JWT_SECRET is not configured');
  }
  return new TextEncoder().encode(secret);
}

/**
 * Mint a short-lived JWT for mobile cycle count access.
 * 15-minute TTL, signed with INTERNAL_JWT_SECRET.
 */
export async function mintMobileJwt(payload: MobileJwtPayload): Promise<string> {
  const secret = getSecret();

  return new SignJWT({
    session_id: payload.sessionId,
    tenant_id: payload.tenantId,
    cycle_count_id: payload.cycleCountId,
    user_id: payload.userId,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(`${JWT_TTL_SECONDS}s`)
    .sign(secret);
}

/**
 * Verify a mobile JWT and extract claims.
 * Throws AppError.unauthorized on invalid/expired tokens.
 */
export async function verifyMobileJwt(token: string): Promise<MobileSession> {
  try {
    const secret = getSecret();
    const { payload } = await jwtVerify(token, secret, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    const sessionId = payload.session_id as string;
    const tenantId = payload.tenant_id as string;
    const cycleCountId = payload.cycle_count_id as string;
    const userId = payload.user_id as string;

    if (!sessionId || !tenantId || !cycleCountId || !userId) {
      throw AppError.unauthorized('Invalid mobile token claims');
    }

    return { sessionId, tenantId, cycleCountId, userId };
  } catch (err: any) {
    if (err instanceof AppError) throw err;
    if (err?.code === 'ERR_JWT_EXPIRED') {
      throw AppError.unauthorized('Mobile session expired — please refresh');
    }
    throw AppError.unauthorized('Invalid mobile token');
  }
}

/**
 * Extract and verify the mobile session from a request's Authorization header.
 * Expects: Authorization: Bearer <jwt>
 */
export async function requireMobileSession(req: Request): Promise<MobileSession> {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    throw AppError.unauthorized('Missing mobile authorization');
  }

  const token = auth.slice(7);
  return verifyMobileJwt(token);
}
