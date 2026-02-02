import { NextRequest, NextResponse } from 'next/server';
import { createUserClient } from '@/lib/db-middleware';

/**
 * POST /api/inventory/rfid/tags/assign
 * Assign an RFID tag to an asset
 */
export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const { epc_hex, asset_id, assignment_method } = body;

    if (!epc_hex || !asset_id) {
      return NextResponse.json(
        { error: 'epc_hex and asset_id are required' },
        { status: 400 }
      );
    }

    // Call RPC function to assign tag to asset
    const { data, error } = await supabase.rpc('rfid_assign_tag_to_asset', {
      p_tenant_id: tenantId,
      p_epc_hex: epc_hex,
      p_asset_id: asset_id,
      p_assignment_method: assignment_method || 'manual',
      p_assigned_by_user_id: userId
    });

    if (error) {
      console.error('Error assigning tag to asset:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to assign tag' },
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      data,
      message: 'Tag assigned to asset successfully'
    });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

