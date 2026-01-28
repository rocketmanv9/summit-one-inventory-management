/**
 * PO Receiving Detail API
 * GET /api/supply-chain/purchase-orders/[id]/receiving - Get PO detail for receiving
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdFromHeaders } from '@/lib/db-middleware';
import { createClient } from '@/lib/db-middleware';

export async function GET(
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

    // Call RPC to get PO receiving detail
    const { data, error } = await supabase
      .schema('supply_chain')
      .rpc('rpc_get_po_receiving_detail', {
        p_tenant_id: tenantId,
        p_po_id: id,
      });

    if (error) {
      console.error('Error fetching PO receiving detail:', error);
      
      if (error.message?.includes('not found')) {
        return NextResponse.json(
          { error: 'Purchase order not found' },
          { status: 404 }
        );
      }
      
      return NextResponse.json(
        { error: 'Failed to fetch PO detail', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
