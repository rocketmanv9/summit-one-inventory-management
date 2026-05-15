import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(async ({ session, log }) => {
  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });
  const prov = (supabase as any).schema('provisioning');

  const { data, error } = await prov
    .from('providers')
    .select('*, provider_item_mappings(count)')
    .eq('tenant_id', session.tenantId!)
    .order('priority', { ascending: true })
    .limit(100);

  if (error) {
    log.error('providers.list_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  return Response.json({ data });
}, { serviceName: SERVICE_NAME });

const CreateProviderSchema = z.object({
  provider_key: z.string().min(1).regex(/^[a-z0-9_-]+$/, 'Must be lowercase alphanumeric with hyphens/underscores'),
  display_name: z.string().min(1),
  provider_type: z.enum(['print_on_demand', 'uniform_vendor', 'internal_warehouse', 'custom']),
  config: z.record(z.unknown()).default({}),
  capabilities: z.array(z.string()).default([]),
  priority: z.number().int().default(100),
  is_active: z.boolean().default(true),
});

export const POST = createSessionWriteRoute(async ({ req, log, supabase, idempotencyKey }) => {
  const body = CreateProviderSchema.parse(await req.json());
  const prov = (supabase as any).schema('provisioning');

  const { data: provider, error } = await prov
    .from('providers')
    .upsert({
      ...body,
      last_event_id: idempotencyKey,
    }, { onConflict: 'last_event_id' })
    .select()
    .single();

  if (error) {
    if (error.message?.includes('uq_providers_tenant_key')) {
      throw AppError.conflict(`Provider with key "${body.provider_key}" already exists`);
    }
    log.error('provider.create_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  log.info('provider.created', { providerId: provider.id, key: provider.provider_key });

  return {
    data: provider,
    status: 201,
    events: [{
      event_name: 'provider.created',
      payload: { provider_id: provider.id, provider_key: provider.provider_key },
      last_event_id: idempotencyKey,
    }],
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/provisioning/providers' });
