import { NextRequest, NextResponse } from 'next/server';
import { createClient, getTenantIdFromHeaders } from '@/lib/db-middleware';

// GET /api/inventory/vendors/[id] - Get single vendor
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const tenantId = getTenantIdFromHeaders(request.headers);

  if (!tenantId) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }

  try {
    const { id } = await params;
    const supabase = createClient();

    const { data: vendor, error } = await supabase
      .schema('supply_chain')
      .from('vendors')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single();

    if (error) {
      console.error('Error fetching vendor:', error);
      return NextResponse.json(
        { error: 'Vendor not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ data: vendor });
  } catch (error) {
    console.error('Error in GET /api/inventory/vendors/[id]:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// PUT /api/inventory/vendors/[id] - Update vendor
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const tenantId = getTenantIdFromHeaders(request.headers);

  if (!tenantId) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const {
      name,
      code,
      contact_name,
      contact_email,
      contact_phone,
      payment_terms,
      lead_time_days,
      notes,
      active,
    } = body;

    const supabase = createClient();

    const { data: vendor, error } = await supabase
      .schema('supply_chain')
      .from('vendors')
      .update({
        name,
        code: code || null,
        contact_name: contact_name || null,
        contact_email: contact_email || null,
        contact_phone: contact_phone || null,
        payment_terms: payment_terms || null,
        lead_time_days: lead_time_days || null,
        notes: notes || null,
        active: active !== undefined ? active : true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (error) {
      // Handle unique constraint violations
      if (error.code === '23505') {
        if (error.message.includes('vendors_tenant_name_unique')) {
          return NextResponse.json(
            { error: 'A vendor with this name already exists' },
            { status: 409 }
          );
        }
        if (error.message.includes('vendors_tenant_code_unique')) {
          return NextResponse.json(
            { error: 'A vendor with this code already exists' },
            { status: 409 }
          );
        }
      }

      console.error('Error updating vendor:', error);
      return NextResponse.json(
        { error: 'Failed to update vendor' },
        { status: 500 }
      );
    }

    if (!vendor) {
      return NextResponse.json(
        { error: 'Vendor not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ data: vendor });
  } catch (error) {
    console.error('Error in PUT /api/inventory/vendors/[id]:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/inventory/vendors/[id] - Delete vendor (soft delete by setting active=false)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const tenantId = getTenantIdFromHeaders(request.headers);

  if (!tenantId) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }

  try {
    const { id } = await params;
    const supabase = createClient();

    // Check if vendor has associated purchase orders
    const { count: poCount } = await supabase
      .schema('supply_chain')
      .from('purchase_orders')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('vendor_location_id', id);

    if (poCount && poCount > 0) {
      return NextResponse.json(
        { error: `Cannot delete vendor. It has ${poCount} associated purchase order(s). Deactivate it instead.` },
        { status: 400 }
      );
    }

    // Soft delete by setting active to false
    const { data: vendor, error } = await supabase
      .schema('supply_chain')
      .from('vendors')
      .update({
        active: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (error) {
      console.error('Error deleting vendor:', error);
      return NextResponse.json(
        { error: 'Failed to delete vendor' },
        { status: 500 }
      );
    }

    if (!vendor) {
      return NextResponse.json(
        { error: 'Vendor not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in DELETE /api/inventory/vendors/[id]:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
