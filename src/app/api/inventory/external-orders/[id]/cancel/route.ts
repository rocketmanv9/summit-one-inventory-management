import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

import { loadOwnedSession } from '@/lib/external-orders';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// ── Item 06 — cancel a session ────────────────────────────────────────────────
// CONTRACT (item 07):
//   POST /api/inventory/external-orders/{id}/cancel   { }  (empty body ok)
//     → 200 { data: { session_id, status: 'cancelled' } }
//   Auth: session, gated to the OWNER. Idempotent: cancelling an already-cancelled
//   session is a no-op success. A completed session cannot be cancelled (409).
//   No PO is drafted; captures are left in place for audit.

const CancelSchema = z.object({}).passthrough();

function extractSessionId(req: Request): string {
  const segs = new URL(req.url).pathname.split('/');
  const id = segs[segs.indexOf('external-orders') + 1];
  if (!id) throw AppError.badRequest('Missing session id');
  return z.string().uuid().parse(id);
}

export const POST = createSessionWriteRoute(async ({ ctx, req, idempotencyKey }) => {
  const sessionId = extractSessionId(req);
  CancelSchema.parse(await req.json().catch(() => ({})));
  const tenantId = ctx.tenantId!;
  const userId = ctx.userId!;

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });
  const sc = (supabase as any).schema('supply_chain');

  const session = await loadOwnedSession(supabase, tenantId, userId, sessionId);
  if (session.status === 'cancelled') {
    return { data: { session_id: sessionId, status: 'cancelled' }, status: 200, events: [] };
  }
  if (session.status === 'completed') {
    throw AppError.conflict('Session is already completed — it cannot be cancelled.');
  }

  await sc
    .from('external_order_sessions')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('tenant_id', tenantId);

  return {
    data: { session_id: sessionId, status: 'cancelled' },
    status: 200,
    events: [{
      event_name: 'external_order_session.cancelled',
      payload: { session_id: sessionId },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/external-orders/[id]/cancel' });
