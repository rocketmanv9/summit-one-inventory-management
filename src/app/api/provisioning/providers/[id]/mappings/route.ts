import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

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

  const { data, error } = await prov
    .from('provider_item_mappings')
    .select('*')
    .eq('provider_id', providerId)
    .eq('tenant_id', session.tenantId!)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    log.error('mappings.list_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  return Response.json({ data });
}, { serviceName: SERVICE_NAME });

const CreateMappingSchema = z.object({
  catalog_item_id: z.string().uuid(),
  external_product_id: z.string().optional(),
  external_variant_id: z.string().optional(),
  unit_cost: z.number().optional(),
  lead_time_days: z.number().int().optional(),
  metadata: z.record(z.unknown()).default({}),
});

export const POST = createSessionWriteRoute(async ({ req, log, supabase, idempotencyKey }) => {
  const providerId = req.url.split('/providers/')[1]?.split('/')[0];
  if (!providerId) throw AppError.badRequest('Provider ID required');

  const body = CreateMappingSchema.parse(await req.json());
  const prov = (supabase as any).schema('provisioning');

  const { data: mapping, error } = await prov
    .from('provider_item_mappings')
    .upsert({
      provider_id: providerId,
      catalog_item_id: body.catalog_item_id,
      external_product_id: body.external_product_id,
      external_variant_id: body.external_variant_id,
      unit_cost: body.unit_cost,
      lead_time_days: body.lead_time_days,
      metadata: body.metadata,
      last_event_id: idempotencyKey,
    }, { onConflict: 'tenant_id,provider_id,catalog_item_id' })
    .select()
    .single();

  if (error) {
    log.error('mapping.create_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  log.info('mapping.created', { mappingId: mapping.id, providerId });

  return {
    data: mapping,
    status: 201,
    events: [{
      event_name: 'provider_mapping.created',
      payload: { mapping_id: mapping.id, provider_id: providerId },
      last_event_id: idempotencyKey,
    }],
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/provisioning/providers/[id]/mappings' });
