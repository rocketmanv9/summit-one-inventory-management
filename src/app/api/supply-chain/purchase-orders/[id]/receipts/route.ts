/**
 * PO Receipt History API
 * GET /api/supply-chain/purchase-orders/[id]/receipts - Get receipt history for PO
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

    // Call RPC to get receipt history
    const { data, error } = await supabase
      .rpc('rpc_get_po_receipt_history', {
        p_po_id: id,
      });

    if (error) {
      console.error('Error fetching receipt history:', error);
      return NextResponse.json(
        { error: 'Failed to fetch receipt history', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: data || [],
      meta: {
        tenantId,
        po_id: id,
        count: data?.length || 0,
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
