/**
 * Purchase Order by ID API
 * PUT /api/inventory/purchasing/[id] - Update PO (draft only)
 * PATCH /api/inventory/purchasing/[id] - Update PO status
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdFromHeaders } from '@/lib/db-middleware';
import { createClient } from '@/lib/db-middleware';

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const tenantId = getTenantIdFromHeaders(request.headers);

  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const { id } = await Promise.resolve(params);
    const body = await request.json();
    const { vendor_id, ship_to_location_id, expected_delivery_date, notes, lines } = body;

    const supabase = createClient();

    // Check if PO is in draft status
    const { data: po, error: fetchError } = await supabase
      .schema('supply_chain')
      .from('purchase_orders')
      .select('status')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single();

    if (fetchError || !po) {
      return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 });
    }

    if (po.status !== 'draft') {
      return NextResponse.json(
        { error: 'Only draft purchase orders can be edited' },
        { status: 400 }
      );
    }

    // Update PO header
    const { error: updateError } = await supabase
      .schema('supply_chain')
      .from('purchase_orders')
      .update({
        vendor_id,
        delivery_location_id: ship_to_location_id,
        expected_delivery_date,
        notes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (updateError) {
      console.error('Error updating PO:', updateError);
      return NextResponse.json({ error: 'Failed to update purchase order' }, { status: 500 });
    }

    // Update lines if provided
    if (lines && lines.length > 0) {
      // Delete existing lines
      await supabase
        .schema('supply_chain')
        .from('purchase_order_lines')
        .delete()
        .eq('po_id', id)
        .eq('tenant_id', tenantId);

      // Insert new lines
      const poLines = lines.map((line: any, index: number) => ({
        tenant_id: tenantId,
        po_id: id,
        line_number: index + 1,
        catalog_item_id: line.catalog_item_id,
        qty_ordered: line.qty,
        unit_cost: line.unit_cost,
        status: 'open',
        last_event_id: `pol-${Date.now()}-${index}-${Math.random().toString(36).substring(7)}`
      }));

      const { error: linesError } = await supabase
        .schema('supply_chain')
        .from('purchase_order_lines')
        .insert(poLines);

      if (linesError) {
        console.error('Error updating PO lines:', linesError);
        return NextResponse.json({ error: 'Failed to update line items' }, { status: 500 });
      }
    }

    // Fetch updated PO
    const { data: updated } = await supabase
      .schema('supply_chain')
      .from('purchase_orders')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single();

    return NextResponse.json({ data: updated });
  } catch (error: any) {
    console.error('Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const tenantId = getTenantIdFromHeaders(request.headers);

  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const { id } = await Promise.resolve(params);
    const body = await request.json();
    const { status } = body;

    const supabase = createClient();
    
    // Get current user info from session cookie
    const sessionCookie = request.cookies.get('inventory_session');
    const session = sessionCookie ? JSON.parse(sessionCookie.value) : null;
    const userId = session?.userId;
    const userRole = session?.role;

    // If status is being changed to 'approved', check separation of duties
    if (status === 'approved') {
      // Fetch the PO to check who created it
      const { data: po } = await supabase
        .schema('supply_chain')
        .from('purchase_orders')
        .select('created_by_user_id')
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .single();

      // Non-admins cannot approve their own POs (separation of duties)
      if (userRole !== 'admin' && po?.created_by_user_id === userId) {
        return NextResponse.json(
          { error: 'You cannot approve purchase orders you created. Another user must approve.' },
          { status: 403 }
        );
      }

      // Update with approval info
      const { data: updated, error: updateError } = await supabase
        .schema('supply_chain')
        .from('purchase_orders')
        .update({
          status: 'approved',
          approved_by_user_id: userId,
          approved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .select()
        .single();

      if (updateError) {
        console.error('Error updating PO status:', updateError);
        return NextResponse.json({ error: 'Failed to approve purchase order' }, { status: 500 });
      }

      return NextResponse.json({ data: updated });
    }

    // For other status updates
    const { data: updated, error: updateError } = await supabase
      .schema('supply_chain')
      .from('purchase_orders')
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating PO status:', updateError);
      return NextResponse.json({ error: 'Failed to update purchase order status' }, { status: 500 });
    }

    return NextResponse.json({ data: updated });
  } catch (error: any) {
    console.error('Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const tenantId = getTenantIdFromHeaders(request.headers);

  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const { id } = await Promise.resolve(params);
    const supabase = createClient();

    // Check if PO exists and get its status
    const { data: po, error: fetchError } = await supabase
      .schema('supply_chain')
      .from('purchase_orders')
      .select('status, po_number, notes')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single();

    if (fetchError || !po) {
      return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 });
    }

    // Only allow deleting draft or awaiting_approval POs
    if (!['draft', 'awaiting_approval'].includes(po.status)) {
      return NextResponse.json(
        { error: `Cannot delete purchase order with status '${po.status}'. Only draft or awaiting approval POs can be deleted.` },
        { status: 400 }
      );
    }

    // Soft delete: Set status to 'cancelled' and add notes
    const { error: deleteError } = await supabase
      .schema('supply_chain')
      .from('purchase_orders')
      .update({
        status: 'cancelled',
        notes: po.notes ? `${po.notes}\n\n[DELETED: ${new Date().toISOString()}]` : `[DELETED: ${new Date().toISOString()}]`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (deleteError) {
      console.error('Error deleting PO:', deleteError);
      return NextResponse.json({ error: 'Failed to delete purchase order' }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true,
      message: `Purchase order ${po.po_number} has been deleted (cancelled)`
    });
  } catch (error: any) {
    console.error('Error deleting purchase order:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
