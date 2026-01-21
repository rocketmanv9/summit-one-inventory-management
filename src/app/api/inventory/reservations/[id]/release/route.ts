// API Route: Release/cancel reservation
// Non-negotiable: Auth, Tenant isolation, Idempotency

import { createClient } from '@/supabase/client';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    
    // Verify authentication
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    if (authError || !session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    // Get tenant_id from JWT
    const tenantId = session.user.app_metadata?.tenant_id;
    if (!tenantId) {
      return NextResponse.json(
        { error: 'No tenant ID in session' },
        { status: 400 }
      );
    }
    
    const reservationId = params.id;
    
    // Optional: Parse request body for idempotency key
    const body = await request.json().catch(() => ({}));
    const lastEventId = body.last_event_id || null;
    
    // Call RPC function (already exists in DB)
    const { data, error } = await supabase.rpc('rpc_inv_release_reservation', {
      p_tenant_id: tenantId,
      p_reservation_id: reservationId,
      p_cancelled_by_user_id: session.user.id,
      p_last_event_id: lastEventId
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
