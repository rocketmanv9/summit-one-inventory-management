import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedClientOrThrow } from '@/lib/secure-server-client';
import { getIdempotencyKey } from '@/lib/db-middleware';

// GET /api/inventory/vendors/[id] - Get single vendor
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await createAuthenticatedClientOrThrow(request);
  if (auth instanceof NextResponse) return auth;

  const { client: supabase, context } = auth;

  try {
    const { id } = await params;

    // RLS automatically filters by tenant_id
    const { data: vendor, error } = await supabase
      .schema('supply_chain')
      .from('vendors')
      .select('*')
      .eq('id', id)
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
  const auth = await createAuthenticatedClientOrThrow(request);
  if (auth instanceof NextResponse) return auth;

  const { client: supabase, context } = auth;

  try {
    // ENFORCE IDEMPOTENCY
    let idempotencyKey: string | null;
    try {
      const { requireIdempotencyKey } = await import('@/lib/db-middleware');
      idempotencyKey = await requireIdempotencyKey(request);
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    
    if (!idempotencyKey) {
      return NextResponse.json(
        { error: 'Idempotency-Key header required for PUT operations' },
        { status: 400 }
      );
    }
    
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

    // RLS automatically filters by tenant_id
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
  const auth = await createAuthenticatedClientOrThrow(request);
  if (auth instanceof NextResponse) return auth;

  const { client: supabase, context } = auth;

  try {
    // ENFORCE IDEMPOTENCY
    let idempotencyKey: string | null;
    try {
      const { requireIdempotencyKey } = await import('@/lib/db-middleware');
      idempotencyKey = await requireIdempotencyKey(request);
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    
    if (!idempotencyKey) {
      return NextResponse.json(
        { error: 'Idempotency-Key header required for DELETE operations' },
        { status: 400 }
      );
    }
    
    const { id } = await params;

    // Check if vendor has associated purchase orders (RLS filters automatically)
    const { count: poCount } = await supabase
      .schema('supply_chain')
      .from('purchase_orders')
      .select('id', { count: 'exact', head: true })
      .eq('vendor_location_id', id);

    if (poCount && poCount > 0) {
      return NextResponse.json(
        { error: `Cannot delete vendor. It has ${poCount} associated purchase order(s). Deactivate it instead.` },
        { status: 400 }
      );
    }

    // Soft delete by setting active to false (RLS filters automatically)
    const { data: vendor, error } = await supabase
      .schema('supply_chain')
      .from('vendors')
      .update({
        active: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
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
