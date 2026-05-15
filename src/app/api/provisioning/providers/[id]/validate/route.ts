import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { getProvider } from '@/lib/provisioning/providers/registry';
import '@/lib/provisioning/providers/internal-warehouse';
import '@/lib/provisioning/providers/printify';
import type { ProviderType } from '@/lib/provisioning/providers/types';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const ValidateSchema = z.object({}).passthrough();

export const POST = createSessionWriteRoute(async ({ req, log, supabase, idempotencyKey, ctx }) => {
  const providerId = req.url.split('/providers/')[1]?.split('/')[0];
  if (!providerId) throw AppError.badRequest('Provider ID required');

  ValidateSchema.parse(await req.json());
  const prov = (supabase as any).schema('provisioning');

  const { data: providerRecord } = await prov
    .from('providers')
    .select('*')
    .eq('id', providerId)
    .eq('tenant_id', ctx.tenantId)
    .limit(1)
    .single();

  if (!providerRecord) throw AppError.notFound('Provider not found');

  const provider = getProvider(providerRecord.provider_type as ProviderType);
  if (!provider) {
    return {
      data: { valid: false, errors: [`No adapter registered for provider type: ${providerRecord.provider_type}`] },
      status: 200,
      events: [],
    };
  }

  const result = await provider.validateConfig(providerRecord.config);

  log.info('provider.validated', { providerId, valid: result.valid });

  return {
    data: result,
    status: 200,
    events: [],
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/provisioning/providers/[id]/validate' });
