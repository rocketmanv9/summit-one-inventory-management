import { createWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { getAdminClient } from '@/utils/supabase/admin';
import { mintMobileJwt } from '@/lib/mobile-auth';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function getToken(req: Request): string {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  const idx = segments.indexOf('sessions');
  const token = idx >= 0 ? segments[idx + 1] : undefined;
  if (!token) throw AppError.badRequest('Missing token');
  return token;
}

export const POST = createWriteRoute(async ({ req, log, idempotencyKey }) => {
  const token = getToken(req);
  const admin = getAdminClient();
  const inv = (admin as any).schema('inventory');

  const { data: session, error } = await inv
    .from('mobile_count_sessions')
    .select('id, tenant_id, cycle_count_id, created_by_user_id, expires_at, revoked_at')
    .eq('token', token)
    .single();

  if (error || !session) throw AppError.notFound('Invalid session token');
  if (session.revoked_at) throw AppError.unauthorized('Session has been revoked');
  if (new Date(session.expires_at) < new Date()) throw AppError.unauthorized('Session has expired');

  await inv
    .from('mobile_count_sessions')
    .update({ last_used_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', session.id);

  const jwt = await mintMobileJwt({
    sessionId: session.id,
    tenantId: session.tenant_id,
    cycleCountId: session.cycle_count_id,
    userId: session.created_by_user_id,
  });

  log.info('mobile_count_session.refreshed', { sessionId: session.id });

  return {
    data: { jwt, expires_at: session.expires_at },
    status: 200,
    events: [],
  };
}, { bodySchema: 'raw',
  serviceName: SERVICE_NAME,
  scope: 'POST /api/m/count/sessions/:token/refresh',
  authenticate: async () => {
    const supabase = getAdminClient();
    return { tenantId: '00000000-0000-0000-0000-000000000000', userId: '00000000-0000-0000-0000-000000000000', supabase };
  },
});
