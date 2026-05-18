import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import {
  getNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
} from '@/lib/provisioning/notifications';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });

  const url = new URL(req.url);
  const unreadOnly = url.searchParams.get('unread_only') === 'true';
  const limit = parseInt(url.searchParams.get('limit') || '50', 10);

  const [notifications, unreadCount] = await Promise.all([
    getNotifications(supabase, session.tenantId!, { unreadOnly, limit }),
    getUnreadCount(supabase, session.tenantId!),
  ]);

  return Response.json({ data: notifications, unread_count: unreadCount });
}, { serviceName: SERVICE_NAME });

const MarkReadSchema = z.object({
  notification_id: z.string().uuid().optional(),
  mark_all_read: z.boolean().optional(),
}).refine(
  (d) => d.notification_id || d.mark_all_read,
  { message: 'Provide notification_id or mark_all_read' },
);

export const PATCH = createSessionWriteRoute(async ({ req, log, supabase, idempotencyKey }) => {
  const body = MarkReadSchema.parse(await req.json());
  const prov = (supabase as any).schema('provisioning');

  // Resolve tenant_id from existing data
  const { data: probe } = await prov
    .from('notifications')
    .select('tenant_id')
    .limit(1);
  const tenantId = probe?.[0]?.tenant_id as string;

  if (body.mark_all_read) {
    await markAllRead(supabase, tenantId);
    log.info('notifications.mark_all_read', { tenantId });
  } else if (body.notification_id) {
    await markRead(supabase, tenantId, body.notification_id);
    log.info('notification.mark_read', { notificationId: body.notification_id });
  }

  return {
    data: { success: true } as any,
    status: 200,
    events: [{
      event_name: 'notification.read',
      payload: {
        notification_id: body.notification_id ?? null,
        mark_all_read: body.mark_all_read ?? false,
      },
      last_event_id: idempotencyKey,
    }],
  };
}, { serviceName: SERVICE_NAME, scope: 'PATCH /api/provisioning/notifications' });
