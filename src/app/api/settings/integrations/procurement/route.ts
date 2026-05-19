/**
 * Procurement Integration Settings — List Available Adapters
 * GET — returns all registered procurement adapters with connection status
 */
import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { getAdminClient } from '@/utils/supabase/admin';
import { listAdapters } from '@/lib/integrations/procurement';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(async ({ session }) => {
  const adminClient = getAdminClient();
  const prov = (adminClient as any).schema('provisioning');

  // Get all connected procurement providers for this tenant
  const { data: connected } = await prov
    .from('providers')
    .select('id, provider_key, display_name, is_active')
    .eq('tenant_id', session.tenantId!)
    .in('provider_type', ['procurement_marketplace', 'procurement_distributor', 'procurement_direct'])
    .limit(50);

  const connectedMap = new Map(
    (connected || []).map((p: any) => [p.provider_key, { id: p.id, isActive: p.is_active }])
  );

  // Combine adapter metadata with connection status
  const adapters = listAdapters().map((meta) => {
    // Check if any connected provider matches this adapter key prefix
    let connectionStatus: 'connected' | 'disconnected' | 'error' = 'disconnected';
    let providerId: string | null = null;

    for (const [key, info] of connectedMap) {
      if ((key as string).startsWith(meta.key)) {
        providerId = (info as any).id;
        connectionStatus = (info as any).isActive ? 'connected' : 'error';
        break;
      }
    }

    return {
      ...meta,
      connectionStatus,
      providerId,
    };
  });

  return Response.json({ data: adapters });
}, { serviceName: SERVICE_NAME });
