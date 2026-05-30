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

// Optimistic-concurrency update. Body carries the page's strip-cleaned column
// updates plus `expected_last_event_id`; the `.eq('last_event_id', …)` guard
// turns a stale write into a 409 (matches the prior InventoryRPC OCC behavior).
export const PATCH = createSessionWriteRoute(async ({ req, log, supabase, idempotencyKey }) => {
  const id = extractId(req);
  const body = await req.json();
  const { expected_last_event_id, id: _id, created_at, tenant_id, last_event_id, ...updates } = body ?? {};
  if (!expected_last_event_id) throw AppError.badRequest('Missing expected_last_event_id');

  const inv = (supabase as any).schema('inventory');
  const { data, error } = await inv.from('catalog_items')
    .update({ ...updates, last_event_id: idempotencyKey })
    .eq('id', id).eq('last_event_id', expected_last_event_id)
    .select('id, last_event_id').maybeSingle();

  if (error) {
    log.error('catalog_item.update_failed', { error: error.message });
    throw AppError.internal(error.message);
  }
  if (!data) throw AppError.conflict('Catalog item was updated by someone else. Please refresh and try again.');

  return { data, status: 200, events: [] };
}, { bodySchema: 'raw', emissionOwner: 'trigger', serviceName: SERVICE_NAME, scope: 'PATCH /api/inventory/items/[id]' });

// Optimistic-concurrency delete — body: { expected_last_event_id }.
export const DELETE = createSessionWriteRoute(async ({ req, log, supabase }) => {
  const id = extractId(req);
  const body = await req.json().catch(() => ({}));
  const expected = body?.expected_last_event_id;
  if (!expected) throw AppError.badRequest('Missing expected_last_event_id');

  const inv = (supabase as any).schema('inventory');
  const { data, error } = await inv.from('catalog_items').delete()
    .eq('id', id).eq('last_event_id', expected)
    .select('id').maybeSingle();

  if (error) {
    log.error('catalog_item.delete_failed', { error: error.message });
    throw AppError.internal(error.message);
  }
  if (!data) throw AppError.conflict('Catalog item was updated by someone else. Please refresh and try again.');

  return { data: { id }, status: 200, events: [] };
}, { bodySchema: 'raw', emissionOwner: 'trigger', serviceName: SERVICE_NAME, scope: 'DELETE /api/inventory/items/[id]' });
