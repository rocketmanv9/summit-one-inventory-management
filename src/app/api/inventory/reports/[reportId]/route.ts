import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth';
import { createAuthenticatedClient } from '@/supabase/client';
import { cookies } from 'next/headers';

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
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ reportId: string }> }
) {
  try {
    const auth = await getAuthContext();
    if (!auth) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { reportId } = await params;
    if (!VALID_REPORTS.includes(reportId as ReportId)) {
      return NextResponse.json({ error: 'Invalid report ID' }, { status: 400 });
    }

    const cookieStore = await cookies();
    const accessToken = cookieStore.get('access_token')?.value;
    if (!accessToken) {
      return NextResponse.json({ error: 'No access token' }, { status: 401 });
    }

    const supabase = createAuthenticatedClient(accessToken).schema('inventory' as any);
    const rpcName = RPC_MAP[reportId as ReportId];

    // Movement summary accepts optional date range query params
    const rpcParams: Record<string, string> = {};
    if (reportId === 'movement-summary') {
      const startDate = request.nextUrl.searchParams.get('start_date');
      const endDate = request.nextUrl.searchParams.get('end_date');
      if (startDate) rpcParams.p_start_date = startDate;
      if (endDate) rpcParams.p_end_date = endDate;
    }

    const { data, error } = await (supabase as any).rpc(rpcName, rpcParams);

    if (error) {
      console.error(`[Reports] RPC error for ${reportId}:`, error);
      return NextResponse.json(
        { error: 'Failed to generate report' },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: data || [] });
  } catch (error) {
    console.error('[Reports] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
