/**
 * Vendors API
 * GET /api/inventory/vendors - List all vendors
 * POST /api/inventory/vendors - Create new vendor
 * 
 * SECURITY: Uses JWT + RLS for tenant isolation
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedClientOrThrow } from '@/lib/secure-server-client';

export async function GET(request: NextRequest) {
  // Validate JWT and get authenticated client
  const auth = await createAuthenticatedClientOrThrow(request);
  if (auth instanceof NextResponse) return auth; // Return 401 if not authenticated

  const { client: supabase, context } = auth;

  try {
    // Query with RLS - tenant_id automatically filtered by RLS policy
    const { data: vendors, error } = await supabase
      .schema('supply_chain')
      .from('vendors')
      .select('*')
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
      meta: { tenantId: context.tenantId, count: vendors?.length || 0 }
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
  // Validate JWT and get authenticated client
  const auth = await createAuthenticatedClientOrThrow(request);
  if (auth instanceof NextResponse) return auth;

  const { client: supabase, context } = auth;

  try {
    // ENFORCE IDEMPOTENCY: Require Idempotency-Key header for vendor creation
    let idempotencyKey: string;
    try {
      const { requireIdempotencyKey } = await import('@/lib/db-middleware');
      idempotencyKey = await requireIdempotencyKey(request);
    } catch (error: any) {
      return NextResponse.json(
        { error: error.message || 'Idempotency-Key header required for vendor creation' },
        { status: 400 }
      );
    }
    
    const body = await request.json();
    const { name, code, contact_name, contact_email, contact_phone, address, payment_terms, lead_time_days } = body;

    // Insert with tenant_id from JWT context (tamper-proof)
    const { data: vendor, error } = await supabase
      .schema('supply_chain')
      .from('vendors')
      .insert({
        tenant_id: context.tenantId, // From JWT app_metadata
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

