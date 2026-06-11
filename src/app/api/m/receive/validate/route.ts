/**
 * Validate a mobile receiving session token and mint a short-lived (15 min)
 * JWT. The client calls this both as a fallback when the page had no
 * server-provided data AND every 12 minutes to refresh the JWT — mirroring
 * /api/m/count/sessions/[token]/{validate,refresh}, but with the raw session
 * token in the body (this route has no [token] path segment).
 */

import { z } from 'zod';
import { createWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { getAdminClient } from '@/utils/supabase/admin';
import { loadReceivingSession, mintReceiveJwt } from '../_lib/receive-session';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const ValidateSchema = z.object({
  token: z.string().min(16),
});

export const POST = createWriteRoute(async ({ req, log }) => {
  const body = ValidateSchema.parse(await req.json());

  const result = await loadReceivingSession(body.token);
  if ('error' in result) throw AppError.unauthorized(result.error);
  const session = result.session;

  const jwt = await mintReceiveJwt({
    sessionId: session.id,
    tenantId: session.tenant_id,
    userId: session.created_by_user_id,
  });

  log.info('mobile_receiving_session.validated', { sessionId: session.id });

  return {
    data: { jwt, expires_at: session.expires_at },
    status: 200,
    // No events — validate/refresh is a read-heavy operation; the chassis
    // emitOutbox fails with "system" tenant_id on unauthenticated write routes
    // (UUID column). Same reasoning as /api/m/count/sessions/[token]/validate.
    events: [],
  };
}, { bodySchema: 'raw',
  serviceName: SERVICE_NAME,
  scope: 'POST /api/m/receive/validate',
  authenticate: async () => {
    const supabase = getAdminClient();
    return { tenantId: '00000000-0000-0000-0000-000000000000', userId: '00000000-0000-0000-0000-000000000000', supabase };
  },
});
