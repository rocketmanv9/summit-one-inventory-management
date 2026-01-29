import { NextRequest, NextResponse } from 'next/server';
import { createUserClient } from '@/lib/db-middleware';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, tenantId, userId } = await createUserClient(request);

    if (!userId) {
      return NextResponse.json({ error: 'User ID not found' }, { status: 401 });
    }

    const { id: receiptId } = await Promise.resolve(params);

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
