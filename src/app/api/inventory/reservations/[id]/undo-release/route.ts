// API Route: Undo release reservation
// Reverses a released reservation back to active status

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
    
    const body = await request.json().catch(() => ({}));
    const lastEventId = body.last_event_id || null;
    
    const { data, error } = await supabase.rpc('rpc_inv_undo_release_reservation', {
      p_tenant_id: tenantId,
      p_reservation_id: id,
      p_user_id: null,
      p_last_event_id: lastEventId
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
