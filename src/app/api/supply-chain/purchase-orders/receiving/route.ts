/**
 * Purchase Orders for Receiving API
 * GET /api/supply-chain/purchase-orders/receiving - Get open POs for receiving
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdFromHeaders } from '@/lib/db-middleware';
import { createClient } from '@/lib/db-middleware';

export async function GET(request: NextRequest) {
  const tenantId = getTenantIdFromHeaders(request.headers);

  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const vendorId = searchParams.get('vendor_id');
    const search = searchParams.get('search');
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    const supabase = createClient();

    // Call RPC to get open POs
    const { data, error } = await supabase
      .rpc('rpc_get_open_pos_for_receiving', {
        p_vendor_id: vendorId || null,
        p_search: search || null,
        p_limit: limit,
      });

    if (error) {
      console.error('Error fetching open POs:', error);
      return NextResponse.json(
        { error: 'Failed to fetch open purchase orders', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: data || [],
      meta: {
        tenantId,
        count: data?.length || 0,
        filters: { vendorId, search },
      },
    });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
