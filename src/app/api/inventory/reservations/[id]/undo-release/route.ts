// API Route: Undo release reservation
// Reverses a released reservation back to active status

import { createUserClient } from '@/lib/db-middleware';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, tenantId, userId } = await createUserClient(request);
    const { id } = await Promise.resolve(params);
    
    // ENFORCE IDEMPOTENCY: Require idempotency key
    let idempotencyKey: string;
    try {
      const { requireIdempotencyKey } = await import('@/lib/db-middleware');
      idempotencyKey = await requireIdempotencyKey(request);
    } catch (error: any) {
      return NextResponse.json(
        { error: error.message || 'Idempotency-Key header required for undo-release' },
        { status: 400 }
      );
    }
    
    const { data, error } = await supabase.rpc('rpc_inv_undo_release_reservation', {
      p_tenant_id: tenantId,
      p_reservation_id: id,
      p_user_id: userId,
      p_last_event_id: idempotencyKey
    });
    
    if (error) {
      if (error.message.includes('only undo released') || error.message.includes('Insufficient stock')) {
        return NextResponse.json(
          { error: error.message, code: 'INVALID_STATUS' },
          { status: 400 }
        );
      }
      
      if (error.message.includes('not found')) {
        return NextResponse.json(
          { error: 'Reservation not found', code: 'NOT_FOUND' },
          { status: 404 }
        );
      }
      
      throw error;
    }
    
    return NextResponse.json({
      success: true,
      message: 'Release reversed successfully'
    });
    
  } catch (error: any) {
    console.error('Error undoing release:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
