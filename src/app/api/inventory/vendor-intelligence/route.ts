import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const QuerySchema = z.object({
  vendor_id: z.string().uuid().optional(),
});

export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const url = new URL(req.url);
  const query = QuerySchema.parse({
    vendor_id: url.searchParams.get('vendor_id') || undefined,
  });

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });

  const sc = (supabase as any).schema('supply_chain');
  const { data, error } = await sc.rpc('rpc_vendor_intelligence', {
    p_tenant_id: session.tenantId,
    p_vendor_id: query.vendor_id ?? null,
  });

  if (error) {
    log.error('vendor_intelligence.fetch_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  return Response.json({ data: data ?? {} });
}, { serviceName: SERVICE_NAME });
