/**
 * Reorder Rule Detail
 * PATCH  — update a reorder rule
 * DELETE — deactivate a reorder rule
 */
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { getAdminClient } from '@/utils/supabase/admin';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// ── PATCH: Update reorder rule ──────────────────────────────────────

const UpdateRuleSchema = z.object({
  item_name: z.string().min(1).optional(),
  reorder_point: z.number().int().min(0).optional(),
  reorder_qty: z.number().int().positive().optional(),
  max_stock: z.number().int().positive().nullable().optional(),
  preferred_provider_id: z.string().uuid().nullable().optional(),
  external_product_id: z.string().nullable().optional(),
  external_variant_id: z.string().nullable().optional(),
  unit_cost: z.number().min(0).nullable().optional(),
  auto_reorder: z.boolean().optional(),
  max_auto_amount: z.number().min(0).nullable().optional(),
  is_active: z.boolean().optional(),
});

export const PATCH = createSessionWriteRoute(async ({ req, ctx, idempotencyKey }) => {
  const body = UpdateRuleSchema.parse(await req.json());

  const pathParts = new URL(req.url).pathname.split('/');
  const ruleId = pathParts[pathParts.length - 1];
  if (!ruleId) throw AppError.badRequest('Missing rule ID');

  const adminClient = getAdminClient();
  const proc = (adminClient as any).schema('procurement');

  // Verify rule belongs to tenant
  const { data: existing } = await proc
    .from('reorder_rules')
    .select('id')
    .eq('id', ruleId)
    .eq('tenant_id', ctx.tenantId!)
    .limit(1)
    .maybeSingle();

  if (!existing) throw AppError.notFound('Reorder rule not found');

  const { data: updated, error } = await proc
    .from('reorder_rules')
    .update({ ...body, last_event_id: idempotencyKey })
    .eq('id', ruleId)
    .select()
    .single();

  if (error) throw AppError.internal(error.message);

  return {
    data: updated,
    status: 200,
    events: [{
      event_name: 'procurement.rule.updated',
      payload: { rule_id: ruleId, changes: Object.keys(body) },
      last_event_id: idempotencyKey,
    }],
  };
}, { serviceName: SERVICE_NAME, scope: 'PATCH /api/procurement/reorder-rules/[ruleId]' });

// ── DELETE: Deactivate reorder rule ─────────────────────────────────

const DeleteSchema = z.object({});

export const DELETE = createSessionWriteRoute(async ({ req, ctx, idempotencyKey }) => {
  DeleteSchema.parse(await req.json());

  const pathParts = new URL(req.url).pathname.split('/');
  const ruleId = pathParts[pathParts.length - 1];
  if (!ruleId) throw AppError.badRequest('Missing rule ID');

  const adminClient = getAdminClient();
  const proc = (adminClient as any).schema('procurement');

  const { data: existing } = await proc
    .from('reorder_rules')
    .select('id')
    .eq('id', ruleId)
    .eq('tenant_id', ctx.tenantId!)
    .limit(1)
    .maybeSingle();

  if (!existing) throw AppError.notFound('Reorder rule not found');

  const { error } = await proc
    .from('reorder_rules')
    .update({ is_active: false, last_event_id: idempotencyKey })
    .eq('id', ruleId);

  if (error) throw AppError.internal(error.message);

  return {
    data: { deleted: true, rule_id: ruleId },
    status: 200,
    events: [{
      event_name: 'procurement.rule.updated',
      payload: { rule_id: ruleId, action: 'deactivated' },
      last_event_id: idempotencyKey,
    }],
  };
}, { serviceName: SERVICE_NAME, scope: 'DELETE /api/procurement/reorder-rules/[ruleId]' });
