import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const id = req.url.split('/requests/')[1]?.split('/')[0]?.split('?')[0];
  if (!id) throw AppError.badRequest('Request ID required');

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });
  const prov = (supabase as any).schema('provisioning');

  const { data: request, error } = await prov
    .from('provisioning_requests')
    .select('*, provisioning_lines(*), policy_rules(id, name), kits(id, name)')
    .eq('id', id)
    .eq('tenant_id', session.tenantId!)
    .limit(1)
    .single();

  if (error || !request) {
    throw AppError.notFound('Provisioning request not found');
  }

  // Also fetch history
  const { data: history } = await prov
    .from('provisioning_history')
    .select('*')
    .eq('request_id', id)
    .order('created_at', { ascending: false })
    .limit(100);

  return Response.json({ data: { ...request, history: history ?? [] } });
}, { serviceName: SERVICE_NAME });
