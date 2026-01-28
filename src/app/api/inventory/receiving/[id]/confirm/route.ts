import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdFromHeaders, getUserIdFromHeaders, getUserEmailFromHeaders, trackUserActivity } from '@/lib/db-middleware';
import { createClient } from '@/lib/db-middleware';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const tenantId = getTenantIdFromHeaders(request.headers);
  const userId = getUserIdFromHeaders(request.headers);
  const userEmail = getUserEmailFromHeaders(request.headers);

  if (!tenantId || !userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // Track user activity
  await trackUserActivity(tenantId, userId, userEmail);

  try {
    const { id: receiptId } = await Promise.resolve(params);
    const body = await request.json();
    const { lines } = body;

    if (!lines || !Array.isArray(lines) || lines.length === 0) {
      return NextResponse.json({ error: 'Receipt lines are required' }, { status: 400 });
    }

    const supabase = createClient();

    // Call the confirm receipt RPC with lines data
    const { data, error } = await supabase
      .schema('supply_chain')
      .rpc('rpc_confirm_receipt', {
        p_tenant_id: tenantId,
        p_user_id: userId,
        p_receipt_id: receiptId,
        p_lines: lines
      });

    if (error) {
      console.error('Error confirming receipt:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true,
      data 
    });
  } catch (error: any) {
    console.error('Error confirming receipt:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
