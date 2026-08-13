import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

import { assertCapability } from '@/lib/access-server';
import { rethrowDeleteError } from '@/lib/api/typed-crud';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// Edit / remove one per-person link override (item 02 — see ../route.ts for the
// contract). PATCH updates url/active; DELETE removes the row outright (these
// are config rows, not transactional records — same posture as group items).

function extractId(req: Request): string {
  const segs = new URL(req.url).pathname.split('/');
  const id = segs[segs.indexOf('person-links') + 1];
  if (!id) throw AppError.badRequest('Missing person link id');
  return z.string().uuid().parse(id);
}

const UpdateSchema = z.object({
  url: z.string().url().max(2000).optional(),
  active: z.boolean().optional(),
}).refine((b) => b.url !== undefined || b.active !== undefined, { message: 'Nothing to update' });

export const PATCH = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  await assertCapability(supabase, { tenantId: ctx.tenantId!, userId: ctx.userId! }, 'purchase_orders.manage');
  const id = extractId(req);
  const body = UpdateSchema.parse(await req.json());
  const tenantId = ctx.tenantId!;
  const sc = (supabase as any).schema('supply_chain');

  const updates: Record<string, unknown> = { last_event_id: idempotencyKey, updated_at: new Date().toISOString() };
  if (body.url !== undefined) updates.url = body.url;
  if (body.active !== undefined) updates.active = body.active;

  const { data: link, error } = await sc
    .from('buyable_item_person_links')
    .update(updates)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select('*')
    .maybeSingle();
  if (error) { log.error('person_links.update_failed', { error: error.message }); throw AppError.internal(error.message); }
  if (!link) throw AppError.notFound('Person link not found');

  return {
    data: link,
    status: 200,
    events: [{
      event_name: 'buyable_item_person_link.updated',
      payload: { id: link.id, group_item_id: link.group_item_id, hr_person_id: link.hr_person_id, active: link.active },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'PATCH /api/inventory/buyable-groups/person-links/[id]' });

export const DELETE = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  await assertCapability(supabase, { tenantId: ctx.tenantId!, userId: ctx.userId! }, 'purchase_orders.manage');
  const id = extractId(req);
  const tenantId = ctx.tenantId!;
  const sc = (supabase as any).schema('supply_chain');

  const { data: link, error } = await sc
    .from('buyable_item_person_links')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select('id, group_item_id, hr_person_id')
    .maybeSingle();
  if (error) { log.error('person_links.delete_failed', { error: error.message }); rethrowDeleteError(error, 'person link'); }
  if (!link) throw AppError.notFound('Person link not found');

  return {
    data: link,
    status: 200,
    events: [{
      event_name: 'buyable_item_person_link.deleted',
      payload: { id: link.id, group_item_id: link.group_item_id, hr_person_id: link.hr_person_id },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'DELETE /api/inventory/buyable-groups/person-links/[id]' });
