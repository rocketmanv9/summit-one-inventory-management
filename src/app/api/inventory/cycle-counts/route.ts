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
    events: [{
      event_name: 'cycle_count.started',
      payload: {
        cycle_count_id: data,
        location_id: body.location_id,
        count_type: body.count_type,
      },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw',
  serviceName: SERVICE_NAME,
  scope: 'POST /api/inventory/cycle-counts',
});

export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const url = new URL(req.url);
  const status = url.searchParams.get('status');

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });

  const inv = (supabase as any).schema('inventory');
  let query = inv
    .from('cycle_counts')
    .select('*, location:locations(id, name, location_types(name))')
    .order('created_at', { ascending: false })
    .limit(200);

  if (status) query = query.eq('status', status);

  const { data, error } = await query;

  if (error) {
    log.error('cycle_counts.list_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  return Response.json({ data });
}, { serviceName: SERVICE_NAME });
