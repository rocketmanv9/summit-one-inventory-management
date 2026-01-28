import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdFromHeaders, createClient } from '@/lib/db-middleware';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const tenantId = getTenantIdFromHeaders(request.headers);

  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const { id: reportId } = await Promise.resolve(params);
    const supabase = createClient();

    let data, error;

    switch (reportId) {
      case 'stock-valuation':
        ({ data, error } = await supabase
          .schema('inventory')
          .rpc('rpc_report_stock_valuation', {
            p_tenant_id: tenantId
          }));
        break;

      case 'movement-summary':
        const startDate = request.nextUrl.searchParams.get('start_date') || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const endDate = request.nextUrl.searchParams.get('end_date') || new Date().toISOString();
        
        ({ data, error } = await supabase
          .schema('inventory')
          .rpc('rpc_report_movement_summary', {
            p_tenant_id: tenantId,
            p_start_date: startDate,
            p_end_date: endDate
          }));
        break;

      case 'reorder-suggestions':
        ({ data, error } = await supabase
          .schema('inventory')
          .rpc('rpc_report_reorder_suggestions', {
            p_tenant_id: tenantId
          }));
        break;

      default:
        return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    if (error) {
      console.error('Error generating report:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: data || [] });
  } catch (error: any) {
    console.error('Error generating report:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
