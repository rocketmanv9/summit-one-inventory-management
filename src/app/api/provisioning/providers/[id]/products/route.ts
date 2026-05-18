import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { listPrintifyProducts, type PrintifyResolvedConfig } from '@/lib/provisioning/providers/printify-client';
import { resolveProviderSecret, isVaultRef } from '@/lib/provisioning/providers/secrets';
import { getAdminClient } from '@/utils/supabase/admin';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const providerId = req.url.split('/providers/')[1]?.split('/')[0];
  if (!providerId) throw AppError.badRequest('Provider ID required');

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });
  const prov = (supabase as any).schema('provisioning');

  const { data: provider } = await prov
    .from('providers')
    .select('config, provider_type')
    .eq('id', providerId)
    .eq('tenant_id', session.tenantId!)
    .limit(1)
    .single();

  if (!provider) throw AppError.notFound('Provider not found');
  if (provider.provider_type !== 'print_on_demand') {
    throw AppError.badRequest('Product listing only available for print-on-demand providers');
  }

  const config = provider.config as { api_token_ref?: string; shop_id?: string };
  if (!config.api_token_ref || !config.shop_id) {
    throw AppError.badRequest('Provider is not configured (missing api_token_ref or shop_id)');
  }

  const adminClient = getAdminClient();
  let apiToken: string;
  if (isVaultRef(config.api_token_ref)) {
    apiToken = await resolveProviderSecret(adminClient, config.api_token_ref);
  } else {
    apiToken = config.api_token_ref;
  }

  const resolved: PrintifyResolvedConfig = { api_token: apiToken, shop_id: config.shop_id };
  const products = await listPrintifyProducts(resolved);

  return Response.json({ data: products });
}, { serviceName: SERVICE_NAME });
