import { createSessionWriteRoute, createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const url = new URL(req.url);
  const categoryId = url.searchParams.get('category_id');

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });

  const inv = (supabase as any).schema('inventory');
  let query = inv
    .from('catalog_items')
    .select('*')
    .order('name', { ascending: true })
    .limit(500);

  if (categoryId) query = query.eq('category_id', categoryId);

  const { data, error } = await query;

  if (error) {
    log.error('catalog_items.list_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  return Response.json({ data });
}, { serviceName: SERVICE_NAME });

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const body = await req.json();
  const inv = (supabase as any).schema('inventory');

  const { data, error } = await inv.from('catalog_items').upsert(body).select().single();

  if (error) {
    log.error('catalog_item.create_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  return {
    data,
    status: 201,
    events: [{ event_name: 'catalog_item.created', payload: data, last_event_id: idempotencyKey }],
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/inventory/items' });

export const PATCH = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const body = await req.json();
  const { id, ...updates } = body;

  if (!id) throw AppError.badRequest('Missing id');

  const inv = (supabase as any).schema('inventory');

  const { data, error } = await inv.from('catalog_items').update(updates).eq('id', id).select().single();

  if (error) {
    log.error('catalog_item.update_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  return {
    data,
    status: 200,
    events: [{ event_name: 'catalog_item.updated', payload: data, last_event_id: idempotencyKey }],
  };
}, { serviceName: SERVICE_NAME, scope: 'PATCH /api/inventory/items' });
