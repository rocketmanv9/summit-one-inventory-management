import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });

  const inv = (supabase as any).schema('inventory');
  // Read the view, not the raw table: it flattens sku/item_name and computes
  // management_strategy + review_frequency that the page renders.
  const { data, error } = await inv
    .from('v_current_abc_classification')
    .select(
      'catalog_item_id, sku, item_name, classification, annual_usage_qty, annual_usage_value, cumulative_value_pct, value_rank, management_strategy, review_frequency'
    )
    .order('value_rank', { ascending: true })
    .limit(500);

  if (error) {
    log.error('abc_classification.list_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  return Response.json({ data });
}, { serviceName: SERVICE_NAME });
