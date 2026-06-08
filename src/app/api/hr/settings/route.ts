import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const Schema = z.object({
  agent_auto_order_enabled: z.boolean().optional(),
  agent_auto_order_limit: z.number().nonnegative().nullable().optional(),
  hr_tenant_id: z.string().uuid().nullable().optional(),
}).refine(
  (b) => b.agent_auto_order_enabled !== undefined || b.agent_auto_order_limit !== undefined || b.hr_tenant_id !== undefined,
  { message: 'No settings provided' },
);

/**
 * PATCH /api/hr/settings — agent auto-order cap + HR tenant mapping (admin).
 * The agent cap gates ONLY agent-initiated POs (initiated_by='agent'); it is separate
 * from the human auto_approve_limit configured on the Purchasing settings page.
 */
export const PATCH = createSessionWriteRoute(async ({ body, ctx, supabase, idempotencyKey }) => {
  const tenantId = ctx.tenantId!;

  const { data: me } = await supabase.from('local_users').select('role').eq('user_id', ctx.userId).eq('tenant_id', tenantId).maybeSingle();
  if (me?.role !== 'admin') throw AppError.forbidden('Admin role required');

  // Ensure a tenant_settings row exists before updating a subset of columns.
  await supabase.schema('supply_chain').rpc('get_or_create_tenant_settings', { p_tenant_id: tenantId });

  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if (body.agent_auto_order_enabled !== undefined) patch.agent_auto_order_enabled = body.agent_auto_order_enabled;
  if (body.agent_auto_order_limit !== undefined) patch.agent_auto_order_limit = body.agent_auto_order_limit;
  if (body.hr_tenant_id !== undefined) patch.hr_tenant_id = body.hr_tenant_id;

  const { data, error } = await supabase
    .schema('supply_chain')
    .from('tenant_settings')
    .update(patch)
    .eq('tenant_id', tenantId)
    .select('agent_auto_order_enabled, agent_auto_order_limit, hr_tenant_id')
    .maybeSingle();
  if (error) throw AppError.internal(error.message);

  return {
    data,
    status: 200,
    events: [{
      event_name: 'tenant_settings.agent_limit_updated',
      payload: { tenant_id: tenantId, ...patch },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: Schema, serviceName: SERVICE_NAME, scope: 'PATCH /api/hr/settings' });
