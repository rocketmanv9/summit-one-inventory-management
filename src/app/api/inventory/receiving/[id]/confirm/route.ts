import { NextRequest, NextResponse } from 'next/server';
import { createUserClient } from '@/lib/db-middleware';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, tenantId, userId } = await createUserClient(request);

    // ENFORCE IDEMPOTENCY
    let idempotencyKey: string;
    try {
      const { requireIdempotencyKey } = await import('@/lib/db-middleware');
      idempotencyKey = await requireIdempotencyKey(request);
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (!userId) {
      return NextResponse.json({ error: 'User ID not found' }, { status: 401 });
    }

    const { id } = await params;
    const { id: receiptId } = await Promise.resolve(params);
    const body = await request.json();
    const { lines } = body;

    if (!lines || !Array.isArray(lines) || lines.length === 0) {
      return NextResponse.json({ error: 'Receipt lines are required' }, { status: 400 });
    }

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
