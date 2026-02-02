/**
 * Asset Return API
 * POST /api/inventory/assets/[id]/return - Return an assigned asset
 */

import { NextRequest, NextResponse } from 'next/server';
import { createUserClient } from '@/lib/db-middleware';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: assetId } = await params;

  try {
    const { supabase, tenantId, userId } = await createUserClient(request);

    // ENFORCE IDEMPOTENCY
    let idempotencyKey: string;
    try {
      const { requireIdempotencyKey } = await import('@/lib/db-middleware');
      idempotencyKey = await requireIdempotencyKey(request);
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (!userId) {
      return NextResponse.json({ error: 'User ID not found' }, { status: 401 });
    }

    const body = await request.json();
    const { notes, condition } = body;

    // Find active assignment
    const { data: assignment, error: findError } = await supabase
      .schema('inventory')
      .from('asset_assignments')
      .select('id, assigned_at, assigned_to_type, assigned_to_id')
      .eq('asset_id', assetId)
      .is('returned_at', null)
      .single();

    if (findError || !assignment) {
      return NextResponse.json(
        { error: 'No active assignment found for this asset' },
        { status: 404 }
      );
    }

    // Use RPC for atomic asset return
    const { data: result, error: rpcError } = await supabase
      .schema('inventory')
      .rpc('rpc_inv_asset_return', {
        p_asset_id: assetId,
        p_actor_user_id: userId,
        p_return_notes: notes,
        p_return_condition: condition
      });

    if (rpcError) {
      console.error('Error returning asset via RPC:', rpcError);
      return NextResponse.json(
        { error: rpcError.message || 'Failed to return asset' },
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      data: result,
      success: true,
      message: 'Asset returned successfully' 
    });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
