// API Route: Fulfill reservation (issue stock)
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
    
    // ENFORCE IDEMPOTENCY (STRICT)
    let idempotencyKey: string;
    try {
      const { requireIdempotencyKey } = await import('@/lib/db-middleware');
      idempotencyKey = await requireIdempotencyKey(request);
    } catch (error: any) {
      return NextResponse.json(
        { error: error.message || 'Idempotency-Key header required for fulfillment' },
        { status: 400 }
      );
    }
    
    // Call RPC function with idempotency key
    const { data, error } = await supabase.rpc('rpc_inv_fulfill_reservation_issue', {
      p_tenant_id: tenantId,
      p_reservation_id: id,
      p_fulfilled_by_user_id: userId,
      p_last_event_id: idempotencyKey
    });
    
    if (error) {
      // Check if it's a business rule violation
      if (error.message.includes('cannot be fulfilled')) {
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
      movement_id: data,
      message: 'Reservation fulfilled successfully'
    });
    
  } catch (error: any) {
    console.error('Error fulfilling reservation:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
