import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// GET /api/inventory/usage-trends?months=13
// Monthly usage / received / on-hand series per consumable item, for the
// seasonal "Usage Trends" view. Powered by inventory.rpc_report_monthly_usage.
export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const url = new URL(req.url);
  const monthsRaw = parseInt(url.searchParams.get('months') || '13', 10);
  const months = Number.isFinite(monthsRaw) ? Math.min(Math.max(monthsRaw, 3), 36) : 13;

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });

  const inv = (supabase as any).schema('inventory');
  const { data, error } = await inv.rpc('rpc_report_monthly_usage', {
    p_tenant_id: session.tenantId,
    p_months: months,
  });

  if (error) {
    log.error('usage_trends.failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  return Response.json({ data: data || [], months });
}, { serviceName: SERVICE_NAME });
