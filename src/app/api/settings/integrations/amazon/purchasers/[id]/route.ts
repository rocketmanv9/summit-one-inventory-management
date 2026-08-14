/**
 * Amazon purchaser registry — single row (item 06).
 *
 * PATCH  — edit amazon email / account type / punchout flag / active / notes.
 * DELETE — REMOVE the row outright.
 *
 * Why a hard delete here (external purchase links soft-delete instead): the
 * registry's whole meaning is "the list of people with an Amazon seat". A
 * deactivated ghost row still counts toward "is the gate configured", and a
 * person who never had a seat shouldn't linger as a denied entry. Turning
 * someone OFF without removing them is what `active: false` /
 * `can_punch_out: false` are for — both one click away in the UI.
 */
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

import { assertCapability } from '@/lib/access-server';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function extractId(req: Request): string {
  const segs = new URL(req.url).pathname.split('/');
  const id = segs[segs.indexOf('purchasers') + 1];
  if (!id) throw AppError.badRequest('Missing purchaser id');
  return id;
}

const UpdateSchema = z.object({
  amazon_email: z.string().email().max(320).nullable().optional(),
  account_type: z.enum(['business', 'personal']).optional(),
  can_punch_out: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
  active: z.boolean().optional(),
});

export const PATCH = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  await assertCapability(supabase, { tenantId: ctx.tenantId!, userId: ctx.userId! }, 'purchase_orders.manage');
  const id = extractId(req);
  const body = UpdateSchema.parse(await req.json());

  const updates: Record<string, unknown> = {
    last_event_id: idempotencyKey,
    updated_at: new Date().toISOString(),
  };
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined) updates[k] = v;
  }

  const sc = (supabase as any).schema('supply_chain');
  const { data, error } = await sc
    .from('amazon_purchaser_accounts')
    .update(updates)
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .select('*')
    .maybeSingle();

  if (error) {
    log.error('amazon.purchaser.update_failed', { error: error.message });
    throw AppError.internal(error.message);
  }
  if (!data) throw AppError.notFound('Amazon purchaser not found');

  return {
    data,
    status: 200,
    events: [{
      event_name: 'amazon_purchaser.updated',
      payload: { id: data.id, user_id: data.user_id, active: data.active, can_punch_out: data.can_punch_out },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'PATCH /api/settings/integrations/amazon/purchasers/[id]' });

export const DELETE = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  await assertCapability(supabase, { tenantId: ctx.tenantId!, userId: ctx.userId! }, 'purchase_orders.manage');
  const id = extractId(req);

  const sc = (supabase as any).schema('supply_chain');
  const { data, error } = await sc
    .from('amazon_purchaser_accounts')
    .delete()
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .select('id, user_id')
    .maybeSingle();

  if (error) {
    log.error('amazon.purchaser.delete_failed', { error: error.message });
    throw AppError.internal(error.message);
  }
  // A repeat DELETE (retry, double-click) is a success, not a 404 — the row is
  // gone either way.
  if (!data) return { data: { id, removed: false }, status: 200, events: [] };

  return {
    data: { ...data, removed: true },
    status: 200,
    events: [{
      event_name: 'amazon_purchaser.removed',
      payload: { id: data.id, user_id: data.user_id },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'DELETE /api/settings/integrations/amazon/purchasers/[id]' });
