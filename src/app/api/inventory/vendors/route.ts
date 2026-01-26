/**
 * Vendors API
 * GET /api/inventory/vendors - List all vendors
 * POST /api/inventory/vendors - Create new vendor
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdFromHeaders, createClient, setDbTenantContext } from '@/lib/db-middleware';

export async function GET(request: NextRequest) {
  const tenantId = getTenantIdFromHeaders(request.headers);

  if (!tenantId) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }

  try {
    const supabase = createClient();

    const { data: vendors, error } = await supabase
      .schema('supply_chain')
      .from('vendors')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .order('name');

    if (error) {
      console.error('Error fetching vendors:', error);
      return NextResponse.json(
        { error: 'Failed to fetch vendors' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: vendors,
      meta: { tenantId, count: vendors?.length || 0 }
    });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const tenantId = getTenantIdFromHeaders(request.headers);

  if (!tenantId) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const { name, code, contact_name, contact_email, contact_phone, address, payment_terms, lead_time_days } = body;

    // Set tenant context for RLS
    await setDbTenantContext(tenantId);
    
    const supabase = createClient();

    const { data: vendor, error } = await supabase
      .schema('supply_chain')
      .from('vendors')
      .insert({
        tenant_id: tenantId,
        name,
        code,
        contact_name,
        contact_email,
        contact_phone,
        address,
        payment_terms,
        lead_time_days: lead_time_days || null,
        active: true,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating vendor:', error);
      return NextResponse.json(
        { error: 'Failed to create vendor' },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: vendor }, { status: 201 });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
