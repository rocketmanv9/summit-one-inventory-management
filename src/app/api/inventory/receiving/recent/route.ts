import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdFromHeaders, createClient } from '@/lib/db-middleware';

export async function GET(request: NextRequest) {
  const tenantId = getTenantIdFromHeaders(request.headers);

  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const supabase = createClient();

    const { data, error } = await supabase
      .schema('supply_chain')
      .rpc('rpc_get_recent_receipts', {
        p_tenant_id: tenantId,
        p_days: 30
      });

    if (error) {
      console.error('Error fetching recent receipts:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: data || [] });
  } catch (error: any) {
    console.error('Error fetching recent receipts:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
