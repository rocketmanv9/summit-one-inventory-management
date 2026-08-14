/**
 * Amazon purchaser registry — collection endpoint (item 06).
 *
 * GET  — list the tenant's registry rows (the hub reads /overview instead;
 *        this exists for scripts and for verifying the gate in isolation).
 * POST — register a person as an Amazon purchaser.
 *
 * Writes are gated on `purchase_orders.manage`, the same purchasing-admin
 * capability that governs POs and the external purchase-link catalog.
 */
import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

import { assertCapability } from '@/lib/access-server';
import { listPurchaserAccounts } from '@/lib/amazon-access';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const CreateSchema = z.object({
  user_id: z.string().uuid(),
  // The address on their Amazon Business seat — often not their work email.
  amazon_email: z.string().email().max(320).nullable().optional(),
  account_type: z.enum(['business', 'personal']).optional(),
  can_punch_out: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
  active: z.boolean().optional(),
});

export const GET = createSessionReadRoute(async ({ session }) => {
  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });
  const rows = await listPurchaserAccounts(supabase, session.tenantId!);
  return Response.json({ data: rows });
}, { serviceName: SERVICE_NAME });

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  await assertCapability(supabase, { tenantId: ctx.tenantId!, userId: ctx.userId! }, 'purchase_orders.manage');
  const body = CreateSchema.parse(await req.json());

  const sc = (supabase as any).schema('supply_chain');

  // The person has to be a real app user — the registry keys on local_users.
  const { data: user } = await supabase
    .from('local_users')
    .select('user_id, email, name')
    .eq('tenant_id', ctx.tenantId!)
    .eq('user_id', body.user_id)
    .maybeSingle();
  if (!user) throw AppError.badRequest('That person is not an app user in this tenant.');

  // Upsert on (tenant_id, user_id): re-adding someone edits their row instead of
  // creating a duplicate, which is also what makes a retry safe.
  const { data, error } = await sc
    .from('amazon_purchaser_accounts')
    .upsert({
      tenant_id: ctx.tenantId,
      user_id: body.user_id,
      amazon_email: body.amazon_email ?? user.email ?? null,
      account_type: body.account_type ?? 'business',
      can_punch_out: body.can_punch_out ?? true,
      notes: body.notes ?? null,
      active: body.active ?? true,
      created_by: ctx.userId,
      updated_at: new Date().toISOString(),
      last_event_id: idempotencyKey,
    }, { onConflict: 'tenant_id,user_id' })
    .select('*')
    .single();

  if (error) {
    log.error('amazon.purchaser.create_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  return {
    data,
    status: 201,
    events: [{
      event_name: 'amazon_purchaser.registered',
      payload: { id: data.id, user_id: data.user_id, can_punch_out: data.can_punch_out },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/settings/integrations/amazon/purchasers' });
