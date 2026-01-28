import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/db-middleware';
import { getTenantIdFromHeaders, getUserIdFromHeaders } from '@/lib/db-middleware';

/**
 * POST /api/inventory/transfers/:id/reverse-receipt
 * Reverses a receipt (correction only - no physical movement)
 * Creates corrective stock movements and reverts to in_transit
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const tenantId = getTenantIdFromHeaders(request.headers);
  const userId = getUserIdFromHeaders(request.headers);

  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const { reason, notes } = body;
    
    if (!reason) {
      return NextResponse.json(
        { error: 'Reason is required for reversing receipt' },
        { status: 400 }
      );
    }
    
    const supabase = createClient();

    const { data, error } = await supabase.rpc('rpc_inv_transfer_reverse_receipt', {
      p_tenant_id: tenantId,
      p_transfer_id: id,
      p_reversed_by_user_id: userId,
      p_reason: reason,
      p_notes: notes || null,
      p_last_event_id: `transfer-reverse-receipt-${id}-${Date.now()}`
    });

    if (error) {
      console.error('Error reversing receipt:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to reverse receipt' },
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      success: true,
      message: 'Receipt reversed successfully. Stock movements corrected and transfer reverted to in-transit.'
    });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
