import { createReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { requireMobileSession } from '@/lib/mobile-auth';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createReadRoute(async ({ req, log }) => {
  const session = await requireMobileSession(req);

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId,
  });

  const inv = (supabase as any).schema('inventory');
  const { data, error } = await inv
    .from('item_categories')
    .select('id, name, sku_prefix')
    .order('name', { ascending: true })
    .limit(200);

  if (error) {
    log.error('mobile_count.categories_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  return Response.json({ data: data || [] });
}, { serviceName: SERVICE_NAME, auth: 'public' });
