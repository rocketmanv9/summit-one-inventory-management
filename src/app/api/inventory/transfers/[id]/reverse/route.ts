import { NextRequest, NextResponse } from 'next/server';
import { createUserClient } from '@/lib/db-middleware';

/**
 * POST /api/inventory/transfers/:id/reverse
 * Creates a reversal transfer for a completed transfer
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, tenantId, userId } = await createUserClient(request);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const { notes, last_event_id } = body;

    // Create reversal transfer using RPC
    const { data: reversalId, error } = await supabase.rpc('rpc_inv_transfer_create_reversal', {
      p_tenant_id: tenantId,
      p_original_transfer_id: id,
      p_initiated_by_user_id: userId,
      p_notes: notes || null,
      p_last_event_id: last_event_id || null
    });

    if (error) {
      console.error('Error creating reversal transfer:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to create reversal transfer' },
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      success: true, 
      data: { reversalId },
      message: 'Reversal transfer created successfully. You can now ship and receive it to complete the reversal.'
    });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
