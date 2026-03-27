import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const VALID_REPORTS = [
  'stock-valuation',
  'movement-summary',
  'reorder-suggestions',
  'dead-stock',
  'velocity-analysis',
  'forecast-report',
] as const;

type ReportId = (typeof VALID_REPORTS)[number];

const RPC_MAP: Record<ReportId, string> = {
  'stock-valuation': 'rpc_report_stock_valuation',
  'movement-summary': 'rpc_report_movement_summary',
  'reorder-suggestions': 'rpc_report_reorder_suggestions',
  'dead-stock': 'rpc_report_dead_stock',
  'velocity-analysis': 'rpc_report_velocity_analysis',
  'forecast-report': 'rpc_report_forecast',
};

/**
 * GET /api/inventory/reports/:reportId
 *
 * Generates a report by calling the corresponding RPC function.
 * Tenant-scoped via current_tenant_id() inside each RPC.
 */
export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  // /api/inventory/reports/[reportId] -> segments = ['', 'api', 'inventory', 'reports', REPORT_ID]
  const reportId = segments[segments.length - 1];

  if (!VALID_REPORTS.includes(reportId as ReportId)) {
    throw AppError.badRequest('Invalid report ID');
  }

  const rpcName = RPC_MAP[reportId as ReportId];

  // Movement summary accepts optional date range query params
  const rpcParams: Record<string, string> = {};
  if (reportId === 'movement-summary') {
    const startDate = url.searchParams.get('start_date');
    const endDate = url.searchParams.get('end_date');
    if (startDate) rpcParams.p_start_date = startDate;
    if (endDate) rpcParams.p_end_date = endDate;
  }

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId,
  });

  const { data, error } = await (supabase as any).schema('inventory').rpc(rpcName, rpcParams);

  if (error) {
    log.error(`[Reports] RPC error for ${reportId}:`, error);
    throw AppError.internal('Failed to generate report');
  }

  return Response.json({ data: data || [] });
}, { serviceName: SERVICE_NAME });
