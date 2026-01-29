/**
 * Asset Assignment API
 * POST /api/inventory/assets/[id]/assign - Assign asset to employee/vehicle/job
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

    if (!userId) {
      return NextResponse.json({ error: 'User ID not found' }, { status: 401 });
    }

    const body = await request.json();
    const { assigned_to_type, assigned_to_id, notes } = body;

    if (!assigned_to_type || !assigned_to_id) {
      return NextResponse.json(
        { error: 'Missing required fields: assigned_to_type, assigned_to_id' },
        { status: 400 }
      );
    }

    // Verify asset exists and belongs to tenant
    const { data: asset, error: assetError } = await supabase
      .schema('inventory')
      .from('assets')
      .select('id, status, asset_tag')
      .eq('id', assetId)
      .single();

    if (assetError || !asset) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    // Use RPC for atomic asset assignment
    const { data: result, error: rpcError } = await supabase
      .schema('inventory')
      .rpc('rpc_inv_asset_assign', {
        p_asset_id: assetId,
        p_assigned_to_type: assigned_to_type,
        p_assigned_to_id: assigned_to_id,
        p_actor_user_id: userId,
        p_notes: notes
      });

    if (rpcError) {
      console.error('Error assigning asset via RPC:', rpcError);
      return NextResponse.json(
        { error: rpcError.message || 'Failed to assign asset' },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: result, message: 'Asset assigned successfully' }, { status: 201 });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
