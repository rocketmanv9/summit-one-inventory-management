// API Route: Release/cancel reservation
// Non-negotiable: Auth, Tenant isolation, Idempotency

import { createClient } from '@/lib/db-middleware';
import { getTenantIdFromHeaders } from '@/lib/db-middleware';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const tenantId = getTenantIdFromHeaders(request.headers);

  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const { id } = await Promise.resolve(params);
    const supabase = createClient();
    
    // Optional: Parse request body for idempotency key
    const body = await request.json().catch(() => ({}));
    const lastEventId = body.last_event_id || null;
    
    // Call RPC function: rpc_inv_release_reservation(p_tenant_id, p_reservation_id, p_cancelled_by_user_id, p_last_event_id)
    const { data, error } = await supabase.rpc('rpc_inv_release_reservation', {
      p_tenant_id: tenantId,
      p_reservation_id: id,
      p_cancelled_by_user_id: null, // TODO: Get from headers if needed
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
