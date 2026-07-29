import { z } from 'zod';
import { createSessionWriteRoute, createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { notifyCountAssignment, assertQualifiedCounter } from '@/lib/counts/assignment-email';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const CreateCycleCountSchema = z.object({
  location_id: z.string().uuid(),
  count_type: z.enum(['full', 'partial', 'spot_check', 'initial']),
  is_blind: z.boolean().optional().default(false),
  scheduled_for: z.string().optional(),
  catalog_item_ids: z.array(z.string().uuid()).nullable().optional(),
  // Optional: assign the count to another qualified counter at creation time.
  // Defaults to the creator (self-assign) when omitted.
  assigned_to_user_id: z.string().uuid().optional(),
});

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, fetch, idempotencyKey }) => {
  const body = CreateCycleCountSchema.parse(await req.json());

  const inv = (supabase as any).schema('inventory');

  const assigneeUserId = body.assigned_to_user_id || ctx.userId;
  if (!assigneeUserId) throw AppError.unauthorized('No user in session context');
  // Only gate on qualification when handing the count to someone else — a
  // creator self-assigning (e.g. an admin) isn't required to be a counter.
  if (body.assigned_to_user_id && body.assigned_to_user_id !== ctx.userId) {
    await assertQualifiedCounter(supabase, ctx.tenantId, body.assigned_to_user_id);
  }

  const { data, error } = await inv.rpc('rpc_inv_cycle_count_start', {
    p_tenant_id: ctx.tenantId,
    p_location_id: body.location_id,
    p_count_type: body.count_type,
    p_catalog_item_ids: body.catalog_item_ids || null,
    p_counted_by_user_id: assigneeUserId,
    p_last_event_id: idempotencyKey,
  });

  if (error) {
    log.error('cycle_count.start_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  log.info('cycle_count.started', { cycleCountId: data, countType: body.count_type, assigneeUserId });

  // Fetch the human-facing number + location for the task/notification copy.
  const { data: created } = await inv
    .from('cycle_counts')
    .select('count_number, count_type, location:locations(name)')
    .eq('id', data)
    .eq('tenant_id', ctx.tenantId)
    .single();

  return {
    data: { id: data },
    status: 201,
    events: [],
    afterCommit: async () => {
      await notifyCountAssignment({
        fetchImpl: fetch,
        supabase,
        log,
        tenantId: ctx.tenantId,
        assigneeUserId,
        actorUserId: ctx.userId,
        // Creating your own count still produces a notification (audit/mobile push).
        alwaysNotify: true,
        counts: [{
          templateName: created?.count_number ? `Count ${created.count_number}` : 'Cycle count',
          locationName: created?.location?.name,
          countType: created?.count_type || body.count_type,
          countNumber: created?.count_number,
          cycleCountId: data,
        }],
      });
    },
  };
}, { bodySchema: 'raw', emissionOwner: 'trigger',
  serviceName: SERVICE_NAME,
  scope: 'POST /api/inventory/cycle-counts',
});

export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  const search = url.searchParams.get('search')?.trim();
  // Scheduling-window filter: due_from/due_to bound the count's effective date
  // (scheduled_for, falling back to created_at for unscheduled counts), and
  // overdue=1 means "scheduled in the past but still not counted".
  const dueFrom = url.searchParams.get('due_from');
  const dueTo = url.searchParams.get('due_to');
  const overdue = url.searchParams.get('overdue') === '1';
  // Paginated by default so the list stays bounded as counts pile up.
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '25', 10) || 25, 1), 100);
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });

  const inv = (supabase as any).schema('inventory');

  // The page itself: filtered, searched, and ranged. `count: 'exact'` gives the
  // total matching rows so the client can render "X–Y of N" + pager controls.
  let query = inv
    .from('cycle_counts')
    .select('*, location:locations(id, name, location_types(name))', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq('status', status);
  // Search is global (server-side), not just the current page — matches the
  // human-facing count number (e.g. "CC-0042").
  if (search) query = query.ilike('count_number', `%${search}%`);
  if (overdue) {
    // Past its scheduled time and still not counted.
    query = query.lt('scheduled_for', new Date().toISOString()).in('status', ['draft', 'scheduled']);
  } else if (dueFrom && dueTo) {
    // Effective date in window: scheduled_for when set, else created_at.
    query = query.or(
      `and(scheduled_for.gte.${dueFrom},scheduled_for.lte.${dueTo}),` +
      `and(scheduled_for.is.null,created_at.gte.${dueFrom},created_at.lte.${dueTo})`
    );
  }

  const { data, error, count } = await query;

  if (error) {
    log.error('cycle_counts.list_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  // Status summary spans ALL of the tenant's counts (ignores the active page /
  // filters) so the stat cards stay accurate regardless of pagination.
  const { data: statusRows, error: summaryError } = await inv
    .from('cycle_counts')
    .select('status')
    .limit(10000);

  if (summaryError) {
    log.error('cycle_counts.summary_failed', { error: summaryError.message });
    throw AppError.internal(summaryError.message);
  }

  const summary = (statusRows || []).reduce((acc: Record<string, number>, r: { status: string }) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  return Response.json({ data, total: count ?? 0, limit, offset, summary });
}, { serviceName: SERVICE_NAME });
