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

  // Auto-register webhooks for print_on_demand providers after successful validation
  if (result.valid && providerRecord.provider_type === 'print_on_demand') {
    try {
      const { resolveProviderSecret, isVaultRef } = await import('@/lib/provisioning/providers/secrets');
      const { listPrintifyWebhooks, registerPrintifyWebhook } = await import('@/lib/provisioning/providers/printify-client');
      const { getAdminClient } = await import('@/utils/supabase/admin');

      const config = providerRecord.config as { api_token_ref?: string; shop_id?: string };
      if (config.api_token_ref && config.shop_id) {
        const adminClient = getAdminClient();
        let apiToken: string;
        if (isVaultRef(config.api_token_ref)) {
          apiToken = await resolveProviderSecret(adminClient, config.api_token_ref);
        } else {
          apiToken = config.api_token_ref;
        }

        const resolved = { api_token: apiToken, shop_id: config.shop_id };
        const existingWebhooks = await listPrintifyWebhooks(resolved);

        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL;
        const webhookUrl = `${baseUrl}/api/webhooks/provisioning/${providerRecord.provider_key}`;
        const requiredTopics = ['order:shipping-update', 'order:status-update'];

        for (const topic of requiredTopics) {
          const exists = existingWebhooks.some((w) => w.topic === topic && w.url === webhookUrl);
          if (!exists) {
            await registerPrintifyWebhook(resolved, webhookUrl, topic);
          }
        }

        // Update webhook status on the provider
        await prov
          .from('providers')
          .update({ webhook_status: 'registered' })
          .eq('id', providerId);

        log.info('provider.webhooks_registered', { providerId, topics: requiredTopics });
      }
    } catch (webhookErr: any) {
      log.warn('provider.webhook_registration_failed', { providerId, error: webhookErr.message });
      await prov
        .from('providers')
        .update({ webhook_status: 'failed' })
        .eq('id', providerId);
    }
  }

  return {
    data: result,
    status: 200,
    events: [],
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/provisioning/providers/[id]/validate' });
