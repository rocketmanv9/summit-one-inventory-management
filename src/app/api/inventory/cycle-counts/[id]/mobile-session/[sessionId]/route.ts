import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function getIds(req: Request): { cycleCountId: string; sessionId: string } {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  // /api/inventory/cycle-counts/[id]/mobile-session/[sessionId]
  const ccIdx = segments.indexOf('cycle-counts');
  const msIdx = segments.indexOf('mobile-session');
  const cycleCountId = ccIdx >= 0 ? segments[ccIdx + 1] : undefined;
  const sessionId = msIdx >= 0 ? segments[msIdx + 1] : undefined;
  if (!cycleCountId) throw AppError.badRequest('Missing cycle count ID');
  if (!sessionId) throw AppError.badRequest('Missing session ID');
  return { cycleCountId, sessionId };
}

export const DELETE = createSessionWriteRoute(async ({ req, log, supabase, idempotencyKey }) => {
  const { cycleCountId, sessionId } = getIds(req);
  const inv = (supabase as any).schema('inventory');

  const { data, error } = await inv
    .from('mobile_count_sessions')
    .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('cycle_count_id', cycleCountId)
    .select()
    .single();

  if (error) throw AppError.internal(error.message);
  if (!data) throw AppError.notFound('Mobile session not found');

  log.info('mobile_count_session.revoked', { sessionId, cycleCountId });

  return {
    data: { revoked: true, session_id: sessionId },
    status: 200,
    events: [{
      event_name: 'mobile_count_session.revoked',
      payload: { session_id: sessionId, cycle_count_id: cycleCountId },
      last_event_id: idempotencyKey,
    }],
  };
}, { serviceName: SERVICE_NAME, scope: 'DELETE /api/inventory/cycle-counts/:id/mobile-session/:sessionId' });
