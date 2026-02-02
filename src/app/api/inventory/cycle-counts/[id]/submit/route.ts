import { NextRequest, NextResponse } from 'next/server';
import { createUserClient } from '@/lib/db-middleware';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, tenantId, userId } = await createUserClient(request);
    
    // ENFORCE IDEMPOTENCY (STRICT)
    let idempotencyKey: string;
    try {
      const { requireIdempotencyKey } = await import('@/lib/db-middleware');
      idempotencyKey = await requireIdempotencyKey(request);
    } catch (error: any) {
      return NextResponse.json(
        { error: error.message || 'Idempotency-Key header required for submitting cycle count' },
        { status: 400 }
      );
    }
    
    const { id: cycleCountId } = await params;

    // Submit the cycle count for review
    const updateData: any = { 
      status: 'under_review',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    if (userId) {
      updateData.updated_by = userId;
    }

    const { error } = await supabase
      .schema('inventory')
      .from('cycle_counts')
      .update(updateData)
      .eq('id', cycleCountId);

    if (error) {
      console.error('Error submitting cycle count:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to submit cycle count for review' },
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      data: { 
        success: true,
        message: 'Cycle count submitted for review successfully'
      } 
    });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
