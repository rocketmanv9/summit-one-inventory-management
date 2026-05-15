import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const id = req.url.split('/policies/')[1]?.split('?')[0];
  if (!id) throw AppError.badRequest('Policy ID required');

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });
  const prov = (supabase as any).schema('provisioning');

  const { data: rule, error } = await prov
    .from('policy_rules')
    .select('*, kits(id, name)')
    .eq('id', id)
    .eq('tenant_id', session.tenantId!)
    .limit(1)
    .single();

  if (error || !rule) {
    throw AppError.notFound('Policy rule not found');
  }

  return Response.json({ data: rule });
}, { serviceName: SERVICE_NAME });

const UpdatePolicySchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  priority: z.number().int().optional(),
  match_positions: z.array(z.string()).optional().nullable(),
  match_divisions: z.array(z.string()).optional().nullable(),
  match_locations: z.array(z.string()).optional().nullable(),
  match_certifications: z.array(z.string()).optional().nullable(),
  match_employment_type: z.string().optional().nullable(),
  match_custom: z.record(z.string(), z.unknown()).optional().nullable(),
  kit_id: z.string().uuid().optional().nullable(),
  items: z.array(z.object({
    catalog_item_id: z.string().uuid(),
    qty: z.number().int().min(1).default(1),
    size_source: z.enum(['employee_profile', 'fixed', 'ask_at_provision']).optional(),
    fixed_variant_attributes: z.record(z.string(), z.string()).optional(),
  })).optional().nullable(),
  trigger_events: z.array(z.string()).optional(),
  effective_from: z.string().optional().nullable(),
  effective_until: z.string().optional().nullable(),
  requires_approval: z.boolean().optional(),
  is_active: z.boolean().optional(),
  last_event_id: z.string(),
});

export const PATCH = createSessionWriteRoute(async ({ req, log, supabase, idempotencyKey }) => {
  const id = req.url.split('/policies/')[1]?.split('?')[0];
  if (!id) throw AppError.badRequest('Policy ID required');

  const body = UpdatePolicySchema.parse(await req.json());
  const prov = (supabase as any).schema('provisioning');

  // OCC check
  const { data: existing } = await prov
    .from('policy_rules')
    .select('last_event_id')
    .eq('id', id)
    .limit(1)
    .single();

  if (!existing) throw AppError.notFound('Policy rule not found');
  if (existing.last_event_id !== body.last_event_id) {
    throw AppError.conflict('Policy was modified by another user');
  }

  const { last_event_id: _old, ...updates } = body;
  const { data: rule, error } = await prov
    .from('policy_rules')
    .update({ ...updates, last_event_id: idempotencyKey })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    log.error('policy.update_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  log.info('policy.updated', { ruleId: id });

  return {
    data: rule,
    status: 200,
    events: [{
      event_name: 'policy_rule.updated',
      payload: { rule_id: id },
      last_event_id: idempotencyKey,
    }],
  };
}, { serviceName: SERVICE_NAME, scope: 'PATCH /api/provisioning/policies/[id]' });
