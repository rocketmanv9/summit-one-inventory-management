import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function getSessionId(req: Request): string {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  // /api/inventory/onboarding/[sessionId]
  const idx = segments.indexOf('onboarding');
  const id = idx >= 0 ? segments[idx + 1] : undefined;
  if (!id) throw AppError.badRequest('Missing session ID');
  return id;
}

export const DELETE = createSessionWriteRoute(async ({ req, log, supabase, idempotencyKey }) => {
  const sessionId = getSessionId(req);
  const inv = (supabase as any).schema('inventory');

  const { data, error } = await inv
    .from('mobile_onboarding_sessions')
    .update({
      revoked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId)
    .is('revoked_at', null)
    .select()
    .single();

  if (error || !data) throw AppError.notFound('Session not found or already revoked');

  log.info('onboarding_session.revoked', { sessionId });

  return {
    data: { revoked: true, session_id: sessionId },
    status: 200,
    events: [{
      event_name: 'onboarding_session.revoked',
      payload: { session_id: sessionId },
      last_event_id: idempotencyKey,
    }],
  };
}, { serviceName: SERVICE_NAME, scope: 'DELETE /api/inventory/onboarding/:sessionId' });
