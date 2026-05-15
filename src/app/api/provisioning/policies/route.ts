import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });
  const prov = (supabase as any).schema('provisioning');

  const url = new URL(req.url);
  const activeOnly = url.searchParams.get('active') === 'true';

  let query = prov
    .from('policy_rules')
    .select('*, kits(id, name)')
    .eq('tenant_id', session.tenantId!)
    .order('priority', { ascending: true })
    .limit(200);

  if (activeOnly) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query;
  if (error) {
    log.error('policies.list_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  return Response.json({ data });
}, { serviceName: SERVICE_NAME });

const CreatePolicySchema = z.object({
  name: z.string().min(1, 'Policy name is required'),
  description: z.string().optional(),
  priority: z.number().int().default(100),
  match_positions: z.array(z.string()).optional().nullable(),
  match_divisions: z.array(z.string()).optional().nullable(),
  match_locations: z.array(z.string()).optional().nullable(),
  match_certifications: z.array(z.string()).optional().nullable(),
  match_employment_type: z.string().optional().nullable(),
  match_custom: z.record(z.unknown()).optional().nullable(),
  kit_id: z.string().uuid().optional().nullable(),
  items: z.array(z.object({
    catalog_item_id: z.string().uuid(),
    qty: z.number().int().min(1).default(1),
    size_source: z.enum(['employee_profile', 'fixed', 'ask_at_provision']).optional(),
    fixed_variant_attributes: z.record(z.string()).optional(),
  })).optional().nullable(),
  trigger_events: z.array(z.string()).min(1, 'At least one trigger event required'),
  effective_from: z.string().optional().nullable(),
  effective_until: z.string().optional().nullable(),
  requires_approval: z.boolean().default(false),
  is_active: z.boolean().default(true),
});

export const POST = createSessionWriteRoute(async ({ req, log, supabase, idempotencyKey }) => {
  const body = CreatePolicySchema.parse(await req.json());
  const prov = (supabase as any).schema('provisioning');

  const { data: rule, error } = await prov
    .from('policy_rules')
    .upsert({
      ...body,
      last_event_id: idempotencyKey,
    }, { onConflict: 'last_event_id' })
    .select()
    .single();

  if (error) {
    log.error('policy.create_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  log.info('policy.created', { ruleId: rule.id, name: rule.name });

  return {
    data: rule,
    status: 201,
    events: [{
      event_name: 'policy_rule.created',
      payload: { rule_id: rule.id, name: rule.name },
      last_event_id: idempotencyKey,
    }],
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/provisioning/policies' });
