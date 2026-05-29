import { createSessionWriteRoute, createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function extractId(req: Request): string {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  const itemsIdx = segments.indexOf('items');
  const id = segments[itemsIdx + 1];
  if (!id) throw AppError.badRequest('Missing item id');
  return id;
}

export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const id = extractId(req);

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });

  const inv = (supabase as any).schema('inventory');
  const { data, error } = await inv.from('catalog_items').select('*').eq('id', id).single();

  if (error) {
    log.error('catalog_item.get_failed', { error: error.message });
    throw AppError.notFound('Item not found');
  }

  return Response.json({ data });
}, { serviceName: SERVICE_NAME });

export const PATCH = createSessionWriteRoute(async ({ req, log, supabase, idempotencyKey }) => {
  const id = extractId(req);
  const body = await req.json();

  const inv = (supabase as any).schema('inventory');
  const { data, error } = await inv.from('catalog_items').update(body).eq('id', id).select().single();

  if (error) {
    log.error('catalog_item.update_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  return {
    data,
    status: 200,
    events: [],
  };
}, { bodySchema: 'raw', emissionOwner: 'trigger', serviceName: SERVICE_NAME, scope: 'PATCH /api/inventory/items/[id]' });

export const DELETE = createSessionWriteRoute(async ({ req, log, supabase, idempotencyKey }) => {
  const id = extractId(req);

  const inv = (supabase as any).schema('inventory');
  const { error } = await inv.from('catalog_items').delete().eq('id', id);

  if (error) {
    log.error('catalog_item.delete_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  return {
    data: { id },
    status: 200,
    events: [],
  };
}, { bodySchema: 'raw', emissionOwner: 'trigger', serviceName: SERVICE_NAME, scope: 'DELETE /api/inventory/items/[id]' });
