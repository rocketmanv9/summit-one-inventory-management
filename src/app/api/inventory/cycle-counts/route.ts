import { z } from 'zod';
import { createSessionWriteRoute, createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const CreateCycleCountSchema = z.object({
  location_id: z.string().uuid(),
  count_type: z.enum(['full', 'partial', 'spot_check', 'initial']),
  is_blind: z.boolean().optional().default(false),
  scheduled_for: z.string().optional(),
  catalog_item_ids: z.array(z.string().uuid()).nullable().optional(),
});

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const body = CreateCycleCountSchema.parse(await req.json());

  const inv = (supabase as any).schema('inventory');

  const { data, error } = await inv.rpc('rpc_inv_cycle_count_start', {
    p_tenant_id: ctx.tenantId,
    p_location_id: body.location_id,
    p_count_type: body.count_type,
    p_catalog_item_ids: body.catalog_item_ids || null,
    p_counted_by_user_id: ctx.userId,
    p_last_event_id: idempotencyKey,
  });

  if (error) {
    log.error('cycle_count.start_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  log.info('cycle_count.started', { cycleCountId: data, countType: body.count_type });

  return {
    data: { id: data },
    status: 201,
    events: [],
  };
}, { bodySchema: 'raw', emissionOwner: 'trigger',
  serviceName: SERVICE_NAME,
  scope: 'POST /api/inventory/cycle-counts',
});

export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  const search = url.searchParams.get('search')?.trim();
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
