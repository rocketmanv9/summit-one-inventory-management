/**
 * Asset Management API
 * PUT /api/inventory/assets/[id] - Update asset
 * DELETE /api/inventory/assets/[id] - Delete asset
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdFromHeaders, getUserIdFromHeaders } from '@/lib/db-middleware';
import { createClient } from '@/lib/db-middleware';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenantId = getTenantIdFromHeaders(request.headers);
  const userId = getUserIdFromHeaders(request.headers);

  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { asset_tag, serial_number, location_id, status, purchase_date, purchase_cost, warranty_expires } = body;

    const supabase = createClient();

    const { data: asset, error } = await supabase
      .schema('inventory')
      .from('assets')
      .update({
        asset_tag,
        serial_number,
        location_id,
        status,
        purchase_date,
        purchase_cost,
        warranty_expires,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (error) {
      console.error('Error updating asset:', error);
      return NextResponse.json({ error: 'Failed to update asset' }, { status: 500 });
    }

    return NextResponse.json({ data: asset });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tenantId = getTenantIdFromHeaders(request.headers);

  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const supabase = createClient();

    // Check for active assignments
    const { data: assignments } = await supabase
      .schema('inventory')
      .from('asset_assignments')
      .select('id')
      .eq('asset_id', id)
      .is('returned_at', null)
      .limit(1);

    if (assignments && assignments.length > 0) {
      return NextResponse.json(
        { error: 'Cannot delete asset with active assignments' },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .schema('inventory')
      .from('assets')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) {
      console.error('Error deleting asset:', error);
      return NextResponse.json({ error: 'Failed to delete asset' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
