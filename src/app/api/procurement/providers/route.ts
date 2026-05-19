/**
 * Procurement Providers
 * GET — list tenant's connected procurement providers
 */
import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { getAdminClient } from '@/utils/supabase/admin';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(async ({ session }) => {
  const adminClient = getAdminClient();
  const prov = (adminClient as any).schema('provisioning');

  const { data, error } = await prov
    .from('providers')
    .select('id, provider_key, display_name, provider_type, capabilities, is_active, created_at')
    .eq('tenant_id', session.tenantId!)
    .in('provider_type', ['procurement_marketplace', 'procurement_distributor', 'procurement_direct'])
    .eq('is_active', true)
    .order('priority', { ascending: true })
    .limit(50);

  if (error) {
    return Response.json({ data: [] });
  }

  return Response.json({ data: data || [] });
}, { serviceName: SERVICE_NAME });
