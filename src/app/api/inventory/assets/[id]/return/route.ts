/**
 * Asset Return API
 * POST /api/inventory/assets/[id]/return - Return an assigned asset
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdFromHeaders, getUserIdFromHeaders } from '@/lib/db-middleware';
import { createClient } from '@/lib/db-middleware';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: assetId } = await params;
  const tenantId = getTenantIdFromHeaders(request.headers);
  const userId = getUserIdFromHeaders(request.headers);

  if (!tenantId || !userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { notes, condition } = body;

    const supabase = createClient();

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

    // Update assignment with return info
    const { error: returnError } = await supabase
      .schema('inventory')
      .from('asset_assignments')
      .update({
        returned_at: new Date().toISOString(),
        returned_by_user_id: userId,
        return_notes: notes,
        return_condition: condition,
      })
      .eq('id', assignment.id);

    if (returnError) {
      console.error('Error returning asset:', returnError);
      return NextResponse.json({ error: 'Failed to return asset' }, { status: 500 });
    }

    // Update asset status back to available
    await supabase
      .schema('inventory')
      .from('assets')
      .update({ 
        status: 'available',
        updated_at: new Date().toISOString()
      })
      .eq('id', assetId)
      .eq('tenant_id', tenantId);

    return NextResponse.json({ 
      success: true,
      message: 'Asset returned successfully' 
    });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
