import { createSessionWriteRoute, createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { getGVClient, getTenantGVClient } from '@/lib/gv';

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

  // Resolve UOM labels from GV for items that have uom_term_id
  if (data && data.length > 0) {
    const termIds = data
      .map((item: any) => item.uom_term_id)
      .filter((id: string | null) => id != null);
    if (termIds.length > 0) {
      try {
        const gv = getGVClient();
        const labels = await gv.displayLabels(session.tenantId!, termIds);
        for (const item of data) {
          if ((item as any).uom_term_id && labels[(item as any).uom_term_id]) {
            (item as any).uom_label = labels[(item as any).uom_term_id];
          }
        }
      } catch (e) {
        log.warn('gv_label_resolve_failed', { error: (e as Error).message });
      }
    }
  }

  return Response.json({ data });
}, { serviceName: SERVICE_NAME });

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const body = await req.json();

  // Resolve uom_term_id from free text if a label was passed instead of a UUID
  if (body.unit_of_measure && !body.uom_term_id) {
    try {
      const gv = await getTenantGVClient(ctx.tenantId);
      body.uom_term_id = await gv.resolveTermId(ctx.tenantId, 'uom', body.unit_of_measure, true);
    } catch (e) {
      log.warn('uom_term_resolve_failed', { uom: body.unit_of_measure, error: (e as Error).message });
    }
  }
  // Remove dropped column — only uom_term_id exists now
  delete body.unit_of_measure;

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
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/items' });

export const PATCH = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const body = await req.json();
  const { id, ...updates } = body;

  if (!id) throw AppError.badRequest('Missing id');

  // Resolve uom_term_id from free text if a label was passed instead of a UUID
  if (updates.unit_of_measure && !updates.uom_term_id) {
    try {
      const gv = await getTenantGVClient(ctx.tenantId);
      updates.uom_term_id = await gv.resolveTermId(ctx.tenantId, 'uom', updates.unit_of_measure, true);
    } catch (e) {
      log.warn('uom_term_resolve_failed', { uom: updates.unit_of_measure, error: (e as Error).message });
    }
  }
  // Remove dropped column — only uom_term_id exists now
  delete updates.unit_of_measure;

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
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'PATCH /api/inventory/items' });
