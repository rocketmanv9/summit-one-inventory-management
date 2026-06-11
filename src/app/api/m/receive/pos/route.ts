/**
 * List open (receivable) purchase orders for the mobile receiving flow.
 *
 * JWT-protected (mobile receiving JWT in Authorization: Bearer) — same
 * `auth: 'public'` + requireReceiveSession() pattern as /api/m/count/search.
 * Returns POs in the approved/sent/partially-received statuses with their
 * outstanding lines (quantities already coerced to numbers server-side).
 */

import { createReadRoute } from '@rocketmanv9/chassis/nextjs';
import { getAdminClient } from '@/utils/supabase/admin';
import { requireReceiveSession, fetchOpenPos } from '../_lib/receive-session';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createReadRoute(async ({ req, log }) => {
  const session = await requireReceiveSession(req);

  // Fire-and-forget: stamp last_used_at on the underlying session.
  const sc = (getAdminClient() as any).schema('supply_chain');
  sc.from('mobile_receiving_sessions')
    .update({ last_used_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', session.sessionId)
    .then(() => {})
    .catch(() => {});

  const pos = await fetchOpenPos(session.tenantId);

  log.info('mobile_receiving.pos_listed', { sessionId: session.sessionId, count: pos.length });

  return Response.json({ data: pos });
}, { serviceName: SERVICE_NAME, auth: 'public' });
