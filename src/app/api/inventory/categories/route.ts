import { createSessionWriteRoute, createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });

  const inv = (supabase as any).schema('inventory');
  const { data, error } = await inv
    .from('item_categories')
    .select('*')
    .order('name', { ascending: true, nullsFirst: false })
    .limit(200);

  if (error) {
    log.error('item_categories.list_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  return Response.json({ data });
}, { serviceName: SERVICE_NAME });

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const body = await req.json();
  const inv = (supabase as any).schema('inventory');

  // item_categories.last_event_id is NOT NULL with no default/trigger — omitting
  // it makes the insert fail. Stamp it (and tenant_id) and upsert on the natural key.
  const { data, error } = await inv
    .from('item_categories')
    .upsert(
      { ...body, tenant_id: ctx.tenantId, last_event_id: idempotencyKey },
      { onConflict: 'tenant_id,name' }
    )
    .select()
    .single();

  if (error) {
    log.error('item_category.create_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  return {
    data,
    status: 201,
    events: [],
  };
}, { bodySchema: 'raw', emissionOwner: 'trigger', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/categories' });
