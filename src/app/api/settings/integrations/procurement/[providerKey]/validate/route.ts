/**
 * Procurement Provider Validation
 * POST — validate an existing provider connection
 */
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { getAdminClient } from '@/utils/supabase/admin';
import { getAdapter, resolveProcurementConfig } from '@/lib/integrations/procurement';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const ValidateSchema = z.object({});

export const POST = createSessionWriteRoute(async ({ req, ctx, log, idempotencyKey }) => {
  ValidateSchema.parse(await req.json());

  const pathParts = new URL(req.url).pathname.split('/');
  // Path: /api/settings/integrations/procurement/[providerKey]/validate
  const providerKeyFromPath = pathParts[pathParts.length - 2];

  if (!providerKeyFromPath) throw AppError.badRequest('Missing provider key');

  const adapter = getAdapter(providerKeyFromPath);
  if (!adapter) throw AppError.notFound(`No adapter found for provider "${providerKeyFromPath}"`);

  const adminClient = getAdminClient();
  const prov = (adminClient as any).schema('provisioning');

  const { data: existing } = await prov
    .from('providers')
    .select('id')
    .eq('tenant_id', ctx.tenantId!)
    .like('provider_key', `${adapter.meta.key}%`)
    .in('provider_type', ['procurement_marketplace', 'procurement_distributor', 'procurement_direct'])
    .limit(1)
    .maybeSingle();

  if (!existing) throw AppError.notFound('No connection found for this provider');

  const config = await resolveProcurementConfig(adminClient, ctx.tenantId!, existing.id);
  const result = await adapter.validateConnection(config);

  return {
    data: result,
    status: 200,
    events: [{ event_name: 'procurement.provider.validated', payload: { provider: adapter.meta.key, valid: result.valid }, last_event_id: idempotencyKey }],
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/settings/integrations/procurement/[providerKey]/validate' });
