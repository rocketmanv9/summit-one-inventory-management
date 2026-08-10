import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

import { assertCapability } from '@/lib/access-server';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function extractId(req: Request): string {
  const segs = new URL(req.url).pathname.split('/');
  const id = segs[segs.indexOf('external-purchase-links') + 1];
  if (!id) throw AppError.badRequest('Missing purchase link id');
  return id;
}

const UpdateLinkSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  url: z.string().url().max(2000).optional(),
  category: z.string().max(120).nullable().optional(),
  vendor_id: z.string().uuid().nullable().optional(),
  allowed_positions: z.array(z.string().min(1).max(200)).max(200).optional(),
  requires_po: z.boolean().optional(),
  monthly_limit: z.number().nonnegative().nullable().optional(),
  icon: z.string().max(120).nullable().optional(),
  active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

// Edit a link (incl. deactivate via active:false).
export const PATCH = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  await assertCapability(supabase, { tenantId: ctx.tenantId!, userId: ctx.userId! }, 'purchase_orders.manage');
  const id = extractId(req);
  const body = UpdateLinkSchema.parse(await req.json());

  const updates: Record<string, unknown> = { last_event_id: idempotencyKey, updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined) updates[k] = v;
  }

  const sc = (supabase as any).schema('supply_chain');
  const { data, error } = await sc
    .from('external_purchase_links')
    .update(updates)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) { log.error('purchase_links.update_failed', { error: error.message }); throw AppError.internal(error.message); }
  if (!data) throw AppError.notFound('Purchase link not found');

  return {
    data,
    status: 200,
    events: [{
      event_name: 'external_purchase_link.updated',
      payload: { id: data.id, name: data.name, active: data.active },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'PATCH /api/inventory/external-purchase-links/[id]' });

// Soft-delete: deactivate the link.
export const DELETE = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  await assertCapability(supabase, { tenantId: ctx.tenantId!, userId: ctx.userId! }, 'purchase_orders.manage');
  const id = extractId(req);

  const sc = (supabase as any).schema('supply_chain');
  const { data, error } = await sc
    .from('external_purchase_links')
    .update({ active: false, last_event_id: idempotencyKey, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, name')
    .maybeSingle();

  if (error) { log.error('purchase_links.delete_failed', { error: error.message }); throw AppError.internal(error.message); }
  if (!data) throw AppError.notFound('Purchase link not found');

  return {
    data,
    status: 200,
    events: [{
      event_name: 'external_purchase_link.deactivated',
      payload: { id: data.id, name: data.name },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'DELETE /api/inventory/external-purchase-links/[id]' });
