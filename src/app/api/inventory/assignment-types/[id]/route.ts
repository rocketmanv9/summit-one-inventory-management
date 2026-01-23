import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/db-middleware';
import { getTenantIdFromHeaders } from '@/lib/db-middleware';

// PUT /api/inventory/assignment-types/[id] - Update assignment type
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const tenantId = getTenantIdFromHeaders(request.headers);

  if (!tenantId) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const { display_name, icon, description, sort_order, is_active, requires_id } = body;

    const supabase = createClient();

    // First verify the assignment type belongs to this tenant and is not system type
    const { data: existingType } = await supabase
      .schema('inventory')
      .from('assignment_types')
      .select('is_system')
      .eq('id', params.id)
      .eq('tenant_id', tenantId)
      .single();

    if (!existingType) {
      return NextResponse.json(
        { error: 'Assignment type not found' },
        { status: 404 }
      );
    }

    // Build update object (only allow certain fields to be updated)
    const updates: any = {
      updated_at: new Date().toISOString(),
    };

    if (display_name !== undefined) updates.display_name = display_name;
    if (icon !== undefined) updates.icon = icon;
    if (description !== undefined) updates.description = description;
    if (sort_order !== undefined) updates.sort_order = sort_order;
    if (requires_id !== undefined) updates.requires_id = requires_id;

    // Only allow deactivating non-system types
    if (is_active !== undefined) {
      if (!is_active && existingType.is_system) {
        return NextResponse.json(
          { error: 'Cannot deactivate system assignment types' },
          { status: 400 }
        );
      }
      updates.is_active = is_active;
    }

    const { data: updatedType, error } = await supabase
      .schema('inventory')
      .from('assignment_types')
      .update(updates)
      .eq('id', params.id)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (error) {
      console.error('Error updating assignment type:', error);
      return NextResponse.json(
        { error: 'Failed to update assignment type' },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: updatedType });
  } catch (error) {
    console.error('Error in PUT /api/inventory/assignment-types/[id]:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/inventory/assignment-types/[id] - Delete assignment type
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const tenantId = getTenantIdFromHeaders(request.headers);

  if (!tenantId) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }

  try {
    const supabase = createClient();

    // Verify the assignment type belongs to this tenant
    const { data: assignmentType } = await supabase
      .schema('inventory')
      .from('assignment_types')
      .select('is_system, type_key')
      .eq('id', params.id)
      .eq('tenant_id', tenantId)
      .single();

    if (!assignmentType) {
      return NextResponse.json(
        { error: 'Assignment type not found' },
        { status: 404 }
      );
    }

    // Prevent deletion of system types
    if (assignmentType.is_system) {
      return NextResponse.json(
        { error: 'Cannot delete system assignment types. You can deactivate them instead.' },
        { status: 400 }
      );
    }

    // Check if type is in use
    const { count } = await supabase
      .schema('inventory')
      .from('asset_assignments')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('assigned_to_type', assignmentType.type_key);

    if (count && count > 0) {
      return NextResponse.json(
        { error: `Cannot delete assignment type. It is currently used by ${count} asset assignment(s). Deactivate it instead.` },
        { status: 400 }
      );
    }

    // Delete the assignment type
    const { error } = await supabase
      .schema('inventory')
      .from('assignment_types')
      .delete()
      .eq('id', params.id)
      .eq('tenant_id', tenantId);

    if (error) {
      console.error('Error deleting assignment type:', error);
      return NextResponse.json(
        { error: 'Failed to delete assignment type' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in DELETE /api/inventory/assignment-types/[id]:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
