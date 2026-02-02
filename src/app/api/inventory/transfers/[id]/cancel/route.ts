import { NextRequest, NextResponse } from 'next/server';
import { createUserClient } from '@/lib/db-middleware';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, tenantId } = await createUserClient(request);
    
    // ENFORCE IDEMPOTENCY (STRICT)
    let idempotencyKey: string;
    try {
      const { requireIdempotencyKey } = await import('@/lib/db-middleware');
      idempotencyKey = await requireIdempotencyKey(request);
    } catch (error: any) {
      return NextResponse.json(
        { error: error.message || 'Idempotency-Key header required for cancelling transfer' },
        { status: 400 }
      );
    }
    
    const { id } = await params;

    // Update transfer status to cancelled
    const { data, error } = await supabase
      .schema('inventory')
      .from('transfers')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'draft') // Only cancel if in draft status
      .select()
      .single();

    if (error) {
      console.error('Error cancelling transfer:', error);
      return NextResponse.json(
        { error: 'Failed to cancel transfer', details: error },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: 'Transfer not found or not in draft status' },
        { status: 404 }
      );
    }

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
