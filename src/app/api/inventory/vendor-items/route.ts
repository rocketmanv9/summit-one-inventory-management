import { createSessionWriteRoute, createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const url = new URL(req.url);
  const vendorId = url.searchParams.get('vendor_id');

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });

  const inv = (supabase as any).schema('inventory');
  let query = inv
    .from('vendor_items')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  if (vendorId) query = query.eq('vendor_id', vendorId);

  const { data, error } = await query;

  if (error) {
    log.error('vendor_items.list_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  return Response.json({ data });
}, { serviceName: SERVICE_NAME });

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const body = await req.json();
  // vendor_items is a VIEW in `inventory`; the real table is in `supply_chain`.
  const sc = (supabase as any).schema('supply_chain');

  const { data, error } = await sc.from('vendor_items')
    .upsert({ ...body, last_event_id: idempotencyKey }).select().single();

  if (error) {
    log.error('vendor_item.create_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  return {
    data,
    status: 201,
    events: [],
  };
}, { bodySchema: 'raw', emissionOwner: 'trigger', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/vendor-items' });
