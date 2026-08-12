import { z } from 'zod';
import { createSessionWriteRoute, createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { notifyCountAssignment, assertQualifiedCounter } from '@/lib/counts/assignment-email';

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

  // Ad-hoc counts — created directly from /inventory/cycle-counts rather than
  // from a schedule template — have no schedule row, so they'd be invisible on
  // the calendar. Surface them as synthetic read-only entries (id prefixed
  // `adhoc-` so the UI treats them as non-editable) keyed on their own date.
  const linkedCountIds = new Set(
    (data || []).map((e: any) => e.cycle_count_id).filter(Boolean)
  );
  let countQuery = inv
    .from('cycle_counts')
    .select('id, count_number, status, count_type, is_blind, scheduled_for, created_at, counted_by_user_id, location:locations(id, name)')
    .eq('tenant_id', session.tenantId)
    .not('status', 'in', '(cancelled)')
    .order('scheduled_for', { ascending: true })
    .limit(500);
  if (from) countQuery = countQuery.gte('scheduled_for', from);
  if (to) countQuery = countQuery.lte('scheduled_for', to);
  const { data: counts, error: countsErr } = await countQuery;
  if (countsErr) {
    // Non-fatal — the template schedule still renders without ad-hoc counts.
    log.warn('count_schedule.adhoc_failed', { error: countsErr.message });
  }

  const adhocUserIds = [...new Set(
    (counts || []).map((c: any) => c.counted_by_user_id).filter((id: string) => id && !userMap[id])
  )];
  if (adhocUserIds.length > 0) {
    const { data: users } = await (supabase as any)
      .from('local_users')
      .select('user_id, name, email')
      .in('user_id', adhocUserIds)
      .limit(500);
    for (const u of users || []) userMap[u.user_id] = { name: u.name, email: u.email };
  }

  const STATUS_MAP: Record<string, string> = {
    draft: 'planned', scheduled: 'planned', in_progress: 'generated',
    under_review: 'generated', approved: 'completed', posted: 'completed', closed: 'completed',
  };
  const adhocEntries = (counts || [])
    .filter((c: any) => !linkedCountIds.has(c.id))
    .map((c: any) => {
      const date = (c.scheduled_for || c.created_at || '').slice(0, 10);
      return {
        id: `adhoc-${c.id}`,
        ad_hoc: true,
        template_id: null,
        scheduled_date: date,
        assigned_to_user_id: c.counted_by_user_id,
        status: STATUS_MAP[c.status] || 'generated',
        cycle_count_id: c.id,
        ai_rationale: null,
        template: {
          id: null,
          name: `${c.count_number} (ad-hoc)`,
          count_type: c.count_type,
          is_blind: c.is_blind,
          location: c.location || null,
        },
        cycle_count: { id: c.id, count_number: c.count_number, status: c.status },
        assignee: c.counted_by_user_id ? userMap[c.counted_by_user_id] ?? null : null,
      };
    });

  return Response.json({ data: [...enriched, ...adhocEntries] });
}, { serviceName: SERVICE_NAME });

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, fetch, idempotencyKey }) => {
  const body = CreateEntrySchema.parse(await req.json());

  if (body.assigned_to_user_id) {
    await assertQualifiedCounter(supabase, ctx.tenantId, body.assigned_to_user_id);
  }

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

  // Resolve template/location names for the notification email
  const { data: template } = await inv
    .from('cycle_count_templates')
    .select('name, count_type, location:locations(name)')
    .eq('id', body.template_id)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();

  return {
    data,
    status: 201,
    events: [{
      event_name: 'cycle_count_schedule.created',
      payload: { entry_id: data.id, template_id: body.template_id, scheduled_date: body.scheduled_date },
      last_event_id: idempotencyKey,
    }],
    afterCommit: async () => {
      if (!body.assigned_to_user_id) return;
      await notifyCountAssignment({
        fetchImpl: fetch,
        supabase,
        log,
        tenantId: ctx.tenantId,
        assigneeUserId: body.assigned_to_user_id,
        actorUserId: ctx.userId,
        counts: [{
          templateName: template?.name || 'Cycle count',
          locationName: template?.location?.name,
          countType: template?.count_type,
          scheduledDate: body.scheduled_date,
        }],
      });
    },
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/count-schedule' });
