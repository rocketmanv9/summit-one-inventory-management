import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdFromHeaders, getUserIdFromHeaders, createClient } from '@/lib/db-middleware';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const tenantId = getTenantIdFromHeaders(request.headers);
  const userId = getUserIdFromHeaders(request.headers);

  if (!tenantId || !userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const { id: receiptId } = await Promise.resolve(params);
    const supabase = createClient();

    const { data, error } = await supabase.rpc('rpc_reverse_receipt', {
      p_tenant_id: tenantId,
      p_user_id: userId,
      p_receipt_id: receiptId,
    });

    if (error) {
      console.error('Error reversing receipt:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Error reversing receipt:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
