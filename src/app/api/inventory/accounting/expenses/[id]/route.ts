import { NextRequest, NextResponse } from 'next/server';
import { createUserClient, getIdempotencyKey } from '@/lib/db-middleware';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase } = await createUserClient(request);
    
    // ENFORCE IDEMPOTENCY
    let idempotencyKey: string | null;
    try {
      idempotencyKey = await getIdempotencyKey(request, 'PATCH');
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    
    if (!idempotencyKey) {
      return NextResponse.json(
        { error: 'Idempotency-Key header required for PATCH operations' },
        { status: 400 }
      );
    }
    
    const { id } = await params;
    const { status, dispute_reason } = await request.json();

    // Update expense status
    const updateData: any = {
      status,
      updated_at: new Date().toISOString()
    };

    if (dispute_reason) {
      updateData.description = dispute_reason; // Store dispute reason in description
    }

    const { data, error } = await supabase
      .from('accounting_expenses')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating expense:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data, success: true });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
