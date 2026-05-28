import { createReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { requireMobileSession } from '@/lib/mobile-auth';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createReadRoute(async ({ req, log }) => {
  const session = await requireMobileSession(req);
  const url = new URL(req.url);
  const categoryId = url.searchParams.get('category_id');
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100);

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId,
  });

  const inv = (supabase as any).schema('inventory');

  // Fetch catalog items
  let query = inv
    .from('catalog_items')
    .select('id, name, sku, barcode, tracking_mode, category_id')
    .order('name', { ascending: true })
    .range(offset, offset + limit - 1);

  if (categoryId) {
    query = query.eq('category_id', categoryId);
  }

  const { data: items, error } = await query;

  if (error) {
    log.error('mobile_count.catalog_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  // Check which items are already in the current count
  const { data: countLines } = await inv
    .from('cycle_count_lines')
    .select('catalog_item_id')
    .eq('cycle_count_id', session.cycleCountId)
    .eq('tenant_id', session.tenantId)
    .limit(500);

  const inCountIds = new Set((countLines || []).map((l: any) => l.catalog_item_id));

  const enriched = (items || []).map((item: any) => ({
    ...item,
    in_count: inCountIds.has(item.id),
  }));

  return Response.json({ data: enriched, has_more: (items || []).length === limit });
}, { serviceName: SERVICE_NAME, auth: 'public' });
