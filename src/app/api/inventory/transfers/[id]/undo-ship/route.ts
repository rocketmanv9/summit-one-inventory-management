import { NextRequest, NextResponse } from 'next/server';
import { createUserClient } from '@/lib/db-middleware';

/**
 * POST /api/inventory/transfers/:id/undo-ship
 * Undoes a shipment (correction only - no physical movement)
 * Reverts in_transit → draft
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, tenantId, userId } = await createUserClient(request);
    const { id } = await params;
    const body = await request.json();
    const { reason, notes, last_event_id } = body;
    
    if (!reason) {
      return NextResponse.json(
        { error: 'Reason is required for undoing shipment' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase.rpc('rpc_inv_transfer_undo_shipment', {
      p_tenant_id: tenantId,
      p_transfer_id: id,
      p_undone_by_user_id: userId,
      p_reason: reason,
      p_notes: notes || null,
      p_last_event_id: last_event_id || null
    });

    if (error) {
      console.error('Error undoing shipment:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to undo shipment' },
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      success: true,
      message: 'Shipment undone successfully. Transfer reverted to draft status.'
    });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
