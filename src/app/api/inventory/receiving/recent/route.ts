import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedClientOrThrow } from '@/lib/secure-server-client';

export async function GET(request: NextRequest) {
  const auth = await createAuthenticatedClientOrThrow(request);
  if (auth instanceof NextResponse) return auth;

  const { client: supabase, context } = auth;

  try {
    const { data, error } = await supabase
      .schema('supply_chain')
      .rpc('rpc_get_recent_receipts', {
        p_tenant_id: context.tenantId,
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

