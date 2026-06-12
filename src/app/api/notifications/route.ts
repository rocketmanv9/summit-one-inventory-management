import { z } from 'zod';
import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// GET /api/notifications — the signed-in user's feed (their own + tenant-wide)
// plus an unread count for the bell badge.
export const GET = createSessionReadRoute(async ({ session, log }) => {
  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });

  const { data, error } = await (supabase as any)
    .from('notifications')
    .select('id, type, title, body, link, read_at, created_at')
    .eq('tenant_id', session.tenantId)
    .or(`user_id.eq.${session.userId},user_id.is.null`)
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) {
    log.error('notifications.list_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  const unread = (data || []).filter((n: any) => !n.read_at).length;
  return Response.json({ data: { notifications: data || [], unread } });
}, { serviceName: SERVICE_NAME });

const MarkReadSchema = z.object({
  // Specific ids, or omit to mark everything read.
  ids: z.array(z.string().uuid()).max(100).optional(),
});

// POST /api/notifications — mark read (body: { ids?: [...] }; no ids = all).
export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const body = MarkReadSchema.parse(await req.json().catch(() => ({})));

  let query = (supabase as any)
    .from('notifications')
    .update({ read_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('tenant_id', ctx.tenantId)
    .is('read_at', null)
    .or(`user_id.eq.${ctx.userId},user_id.is.null`);
  if (body.ids && body.ids.length > 0) {
    query = query.in('id', body.ids);
  }
  const { error } = await query;

  if (error) {
    log.error('notifications.mark_read_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  return {
    data: { success: true },
    status: 200,
    events: [{
      event_name: 'notification.read',
      payload: { user_id: ctx.userId, ids: body.ids ?? 'all' },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/notifications' });
