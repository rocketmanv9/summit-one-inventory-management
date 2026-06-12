import { z } from 'zod';
import { createSessionWriteRoute, createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const CreateEntrySchema = z.object({
  template_id: z.string().uuid(),
  scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  assigned_to_user_id: z.string().uuid().nullable().optional(),
});

// GET /api/inventory/count-schedule?from=YYYY-MM-DD&to=YYYY-MM-DD
export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const url = new URL(req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });

  const inv = (supabase as any).schema('inventory');
  let query = inv
    .from('cycle_count_schedule')
    .select('*, template:cycle_count_templates(id, name, count_type, is_blind, location_id, location:locations(id, name)), cycle_count:cycle_counts(id, count_number, status)')
    .eq('tenant_id', session.tenantId)
    .order('scheduled_date')
    .limit(500);

  if (from) query = query.gte('scheduled_date', from);
  if (to) query = query.lte('scheduled_date', to);

  const { data, error } = await query;

  if (error) {
    log.error('count_schedule.list_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  // Resolve assignee names in one pass so the calendar can render them
  const userIds = [...new Set((data || []).map((e: any) => e.assigned_to_user_id).filter(Boolean))];
  let userMap: Record<string, { name: string; email: string }> = {};
  if (userIds.length > 0) {
    const { data: users } = await (supabase as any)
      .from('local_users')
      .select('user_id, name, email')
      .in('user_id', userIds)
      .limit(500);
    userMap = Object.fromEntries((users || []).map((u: any) => [u.user_id, { name: u.name, email: u.email }]));
  }

  const enriched = (data || []).map((e: any) => ({
    ...e,
    assignee: e.assigned_to_user_id ? userMap[e.assigned_to_user_id] ?? null : null,
  }));

  return Response.json({ data: enriched });
}, { serviceName: SERVICE_NAME });

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const body = CreateEntrySchema.parse(await req.json());

  const inv = (supabase as any).schema('inventory');
  const { data, error } = await inv
    .from('cycle_count_schedule')
    .upsert({
      tenant_id: ctx.tenantId,
      template_id: body.template_id,
      scheduled_date: body.scheduled_date,
      assigned_to_user_id: body.assigned_to_user_id ?? null,
      status: 'planned',
      last_event_id: idempotencyKey,
    }, { onConflict: 'tenant_id,template_id,scheduled_date' })
    .select()
    .single();

  if (error) {
    log.error('count_schedule.create_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  log.info('count_schedule.created', { entryId: data.id, date: body.scheduled_date });

  return {
    data,
    status: 201,
    events: [{
      event_name: 'cycle_count_schedule.created',
      payload: { entry_id: data.id, template_id: body.template_id, scheduled_date: body.scheduled_date },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/count-schedule' });
