// API Route: Undo cancel transfer
// Reverses a cancelled transfer back to draft status

import { createUserClient } from '@/lib/db-middleware';
import { NextRequest, NextResponse } from 'next/server';

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
        { error: error.message || 'Idempotency-Key header required for undo cancel' },
        { status: 400 }
      );
    }
    
    const { id } = await Promise.resolve(params);
    
    const { data, error } = await supabase.rpc('rpc_inv_transfer_undo_cancel', {
      p_tenant_id: tenantId,
      p_transfer_id: id,
      p_user_id: null,
      p_last_event_id: idempotencyKey
    });
    
    if (error) {
      if (error.message.includes('only undo cancelled')) {
        return NextResponse.json(
          { error: error.message, code: 'INVALID_STATUS' },
          { status: 400 }
        );
      }
      
      if (error.message.includes('not found')) {
        return NextResponse.json(
          { error: 'Transfer not found', code: 'NOT_FOUND' },
          { status: 404 }
        );
      }
      
      throw error;
    }
    
    return NextResponse.json({
      success: true,
      message: 'Cancellation reversed successfully'
    });
    
  } catch (error: any) {
    console.error('Error undoing cancellation:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
