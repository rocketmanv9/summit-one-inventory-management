import { createReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { requireMobileSession } from '@/lib/mobile-auth';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createReadRoute(async ({ req, log }) => {
  const session = await requireMobileSession(req);
  const url = new URL(req.url);
  const q = url.searchParams.get('q');

  if (!q || q.trim().length < 1) {
    throw AppError.badRequest('Provide a search query via ?q= parameter');
  }

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId,
  });

  const searchTerm = `%${q.trim()}%`;

  const { data, error } = await supabase
    .from('catalog_items')
    .select('id, name, sku, barcode, tracking_mode, uom_term_id')
    .or(`name.ilike.${searchTerm},sku.ilike.${searchTerm},barcode.eq.${q.trim()}`)
    .limit(20);

  if (error) {
    log.error('mobile_count.search_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  return Response.json({ data: data || [] });
}, { serviceName: SERVICE_NAME, auth: 'public' });
