/**
 * API: Create Receipt Draft
 * POST /api/inventory/receiving/draft
 * Creates a draft receipt for a PO (or returns existing draft)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdFromHeaders, getUserIdFromHeaders, createClient } from '@/lib/db-middleware';

export async function POST(request: NextRequest) {
  const tenantId = getTenantIdFromHeaders(request.headers);
  const userId = getUserIdFromHeaders(request.headers);

  if (!tenantId || !userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { po_id, location_id } = body;

    if (!po_id) {
      return NextResponse.json({ error: 'po_id is required' }, { status: 400 });
    }

    const supabase = createClient();

    // Call RPC to create/get draft receipt
    const { data, error } = await supabase
      .schema('supply_chain')
      .rpc('rpc_create_receipt_draft', {
        p_tenant_id: tenantId,
        p_user_id: userId,
        p_po_id: po_id,
        p_location_id: location_id || null
      });

    if (error) {
      console.error('Error creating draft receipt:', error);
      return NextResponse.json(
        { error: 'Failed to create draft receipt', details: error },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Error in draft receipt endpoint:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
