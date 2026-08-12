/**
 * Printify Product Mapping API (single mapping)
 * DELETE — remove a mapping by id (tenant + provider scoped)
 */
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { getAdminClient } from '@/utils/supabase/admin';
import { idFromPath, rethrowDeleteError } from '@/lib/api/typed-crud';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const DELETE = createSessionWriteRoute(async ({ req, ctx, log, idempotencyKey }) => {
  const id = idFromPath(req, 'mappings');
  const adminClient = getAdminClient();
  const prov = (adminClient as any).schema('provisioning');

  const { data: provider } = await prov
    .from('providers')
    .select('id')
    .eq('tenant_id', ctx.tenantId!)
    .eq('provider_type', 'print_on_demand')
    .like('provider_key', 'printify%')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  if (!provider) {
    throw AppError.badRequest('Printify is not connected.');
  }

  const { data, error } = await prov
    .from('provider_item_mappings')
    .delete()
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId!)
    .eq('provider_id', provider.id)
    .select('id, catalog_item_id')
    .maybeSingle();

  if (error) {
    log.error('printify_mapping.delete_failed', { error: error.message });
    rethrowDeleteError(error, 'Printify mapping');
  }
  if (!data) throw AppError.notFound('Mapping not found');

  return {
    data,
    status: 200,
    events: [{
      event_name: 'mapping.deleted',
      payload: { mapping_id: data.id, catalog_item_id: data.catalog_item_id },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'DELETE /api/settings/integrations/printify/mappings/[id]' });
