// API Route: Release/cancel reservation
// Non-negotiable: Auth, Tenant isolation, Idempotency

import { createUserClient, getIdempotencyKey } from '@/lib/db-middleware';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, tenantId, userId } = await createUserClient(request);
    const { id } = await Promise.resolve(params);
    
    // ENFORCE IDEMPOTENCY: Require idempotency key
    let idempotencyKey: string | null;
    try {
      idempotencyKey = await getIdempotencyKey(request, 'POST');
    } catch (error: any) {
      return NextResponse.json(
        { error: error.message || 'Idempotency-Key header required for release' },
        { status: 400 }
      );
    }
    
    if (!idempotencyKey) {
      return NextResponse.json(
        { error: 'Idempotency-Key header required for reservation release' },
        { status: 400 }
      );
    }
    
    // Call RPC function with idempotency key
    const { data, error } = await supabase.rpc('rpc_inv_release_reservation', {
      p_tenant_id: tenantId,
      p_reservation_id: id,
      p_cancelled_by_user_id: userId,
      p_last_event_id: idempotencyKey
    });
    
    if (error) {
      // Check if it's a business rule violation
      if (error.message.includes('cannot be cancelled')) {
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
      message: 'Reservation released successfully'
    });
    
  } catch (error: any) {
    console.error('Error releasing reservation:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
