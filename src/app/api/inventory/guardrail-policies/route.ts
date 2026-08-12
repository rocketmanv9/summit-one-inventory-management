import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const Schema = z.object({
  over_receipt_policy: z.string(),
  over_receipt_threshold_pct: z.number(),
  uom_mismatch_policy: z.string(),
  require_override_reason: z.boolean(),
});

// One policy row per tenant (onConflict tenant_id); tenant set explicitly to
// match the upsert conflict target. guardrail_policies trigger owns events.
export const POST = createSessionWriteRoute(async ({ ctx, body, log, supabase, idempotencyKey }) => {
  const inv = (supabase as any).schema('inventory');
  const { data, error } = await inv
    .from('guardrail_policies')
    .upsert({ ...body, tenant_id: ctx.tenantId, last_event_id: idempotencyKey }, { onConflict: 'tenant_id' })
    .select()
    .single();
  if (error) { log.error('guardrail_policies.save_failed', { error: error.message }); throw AppError.internal(error.message); }
  return { data, status: 200, events: [] };
}, { bodySchema: Schema, emissionOwner: 'trigger', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/guardrail-policies' });
