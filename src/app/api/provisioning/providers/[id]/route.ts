import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { maskProviderConfig, storeProviderSecret } from '@/lib/provisioning/providers/secrets';
import { getAdminClient } from '@/utils/supabase/admin';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const id = req.url.split('/providers/')[1]?.split('/')[0]?.split('?')[0];
  if (!id) throw AppError.badRequest('Provider ID required');

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });
  const prov = (supabase as any).schema('provisioning');

  const { data: provider, error } = await prov
    .from('providers')
    .select('*, provider_item_mappings(*)')
    .eq('id', id)
    .eq('tenant_id', session.tenantId!)
    .limit(1)
    .single();

  if (error || !provider) throw AppError.notFound('Provider not found');

  return Response.json({ data: { ...provider, config: maskProviderConfig(provider.config) } });
}, { serviceName: SERVICE_NAME });

const UpdateProviderSchema = z.object({
  display_name: z.string().min(1).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  capabilities: z.array(z.string()).optional(),
  priority: z.number().int().optional(),
  is_active: z.boolean().optional(),
  last_event_id: z.string(),
});

export const PATCH = createSessionWriteRoute(async ({ req, log, supabase, idempotencyKey, ctx }) => {
  const id = req.url.split('/providers/')[1]?.split('/')[0]?.split('?')[0];
  if (!id) throw AppError.badRequest('Provider ID required');

  const body = UpdateProviderSchema.parse(await req.json());
  const prov = (supabase as any).schema('provisioning');

  const { data: existing } = await prov
    .from('providers')
    .select('last_event_id, config')
    .eq('id', id)
    .limit(1)
    .single();

  if (!existing) throw AppError.notFound('Provider not found');
  if (existing.last_event_id !== body.last_event_id) {
    throw AppError.conflict('Provider was modified by another user');
  }

  const { last_event_id: _old, ...updates } = body;

  // If config contains a new api_token_ref that is NOT the mask placeholder,
  // store it in Vault and replace with the vault reference name.
  if (updates.config?.api_token_ref && updates.config.api_token_ref !== '********') {
    const rawToken = updates.config.api_token_ref as string;
    if (!rawToken.startsWith('provider-secret-')) {
      const adminClient = getAdminClient();
      const vaultRef = await storeProviderSecret(adminClient, ctx.tenantId!, id, rawToken);
      updates.config = { ...updates.config, api_token_ref: vaultRef };
    }
  } else if (updates.config?.api_token_ref === '********') {
    // User didn't change the token — preserve existing vault ref
    updates.config = { ...updates.config, api_token_ref: existing.config?.api_token_ref };
  }

  const { data: provider, error } = await prov
    .from('providers')
    .update({ ...updates, last_event_id: idempotencyKey })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    log.error('provider.update_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  log.info('provider.updated', { providerId: id });

  return {
    data: { ...provider, config: maskProviderConfig(provider.config) },
    status: 200,
    events: [{
      event_name: 'provider.updated',
      payload: { provider_id: id },
      last_event_id: idempotencyKey,
    }],
  };
}, { serviceName: SERVICE_NAME, scope: 'PATCH /api/provisioning/providers/[id]' });
