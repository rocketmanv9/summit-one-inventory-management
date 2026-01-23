/**
 * Asset Assignment API
 * POST /api/inventory/assets/[id]/assign - Assign asset to employee/vehicle/job
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
    const { assigned_to_type, assigned_to_id, notes } = body;

    if (!assigned_to_type || !assigned_to_id) {
      return NextResponse.json(
        { error: 'Missing required fields: assigned_to_type, assigned_to_id' },
        { status: 400 }
      );
    }

    const supabase = createClient();

    // Verify asset exists and belongs to tenant
    const { data: asset, error: assetError } = await supabase
      .schema('inventory')
      .from('assets')
      .select('id, status, asset_tag')
      .eq('id', assetId)
      .eq('tenant_id', tenantId)
      .single();

    if (assetError || !asset) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    // Check for existing active assignment
    const { data: existingAssignment } = await supabase
      .schema('inventory')
      .from('asset_assignments')
      .select('id')
      .eq('asset_id', assetId)
      .is('returned_at', null)
      .limit(1);

    if (existingAssignment && existingAssignment.length > 0) {
      return NextResponse.json(
        { error: 'Asset already has an active assignment. Return it first.' },
        { status: 400 }
      );
    }

    // Create assignment
    const { data: assignment, error: assignmentError } = await supabase
      .schema('inventory')
      .from('asset_assignments')
      .insert({
        tenant_id: tenantId,
        asset_id: assetId,
        assigned_to_type,
        assigned_to_id,
        assigned_by_user_id: userId,
        assigned_at: new Date().toISOString(),
        notes,
      })
      .select()
      .single();

    if (assignmentError) {
      console.error('Error creating assignment:', assignmentError);
      return NextResponse.json(
        { error: 'Failed to create assignment', details: assignmentError },
        { status: 500 }
      );
    }

    // Update asset status
    await supabase
      .schema('inventory')
      .from('assets')
      .update({ 
        status: 'in_use',
        updated_at: new Date().toISOString()
      })
      .eq('id', assetId)
      .eq('tenant_id', tenantId);

    return NextResponse.json({ data: assignment }, { status: 201 });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
