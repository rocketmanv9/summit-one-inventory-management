import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { maskProviderConfig, storeProviderSecret } from '@/lib/provisioning/providers/secrets';
import { getAdminClient } from '@/utils/supabase/admin';

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

  const masked = (data ?? []).map((p: any) => ({ ...p, config: maskProviderConfig(p.config) }));

  return Response.json({ data: masked });
}, { serviceName: SERVICE_NAME });

const CreateProviderSchema = z.object({
  provider_key: z.string().min(1).regex(/^[a-z0-9_-]+$/, 'Must be lowercase alphanumeric with hyphens/underscores'),
  display_name: z.string().min(1),
  provider_type: z.enum(['print_on_demand', 'uniform_vendor', 'internal_warehouse', 'custom']),
  config: z.record(z.string(), z.unknown()).default({}),
  capabilities: z.array(z.string()).default([]),
  priority: z.number().int().default(100),
  is_active: z.boolean().default(true),
});

export const POST = createSessionWriteRoute(async ({ req, log, supabase, idempotencyKey, ctx }) => {
  const body = CreateProviderSchema.parse(await req.json());
  const prov = (supabase as any).schema('provisioning');

  // Store API token in Vault if present in config
  const configToStore = { ...body.config };
  const rawToken = configToStore.api_token_ref as string | undefined;

  const { data: provider, error } = await prov
    .from('providers')
    .upsert({
      ...body,
      config: configToStore,
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

  // Move plaintext token into Vault now that we have the provider ID
  if (rawToken && !rawToken.startsWith('provider-secret-')) {
    const adminClient = getAdminClient();
    const vaultRef = await storeProviderSecret(adminClient, ctx.tenantId!, provider.id, rawToken);
    await prov
      .from('providers')
      .update({ config: { ...provider.config, api_token_ref: vaultRef } })
      .eq('id', provider.id);
    provider.config.api_token_ref = vaultRef;
  }

  log.info('provider.created', { providerId: provider.id, key: provider.provider_key });

  return {
    data: { ...provider, config: maskProviderConfig(provider.config) },
    status: 201,
    events: [{
      event_name: 'provider.created',
      payload: { provider_id: provider.id, provider_key: provider.provider_key },
      last_event_id: idempotencyKey,
    }],
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/provisioning/providers' });
