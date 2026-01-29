/**
 * PO Receiving Detail API
 * GET /api/supply-chain/purchase-orders/[id]/receiving - Get PO detail for receiving
 * SECURITY: Uses JWT + RLS for tenant isolation
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedClientOrThrow } from '@/lib/secure-server-client';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await createAuthenticatedClientOrThrow(request);
  if (auth instanceof NextResponse) return auth;

  const { client: supabase, context } = auth;

  try {
    const { id } = await Promise.resolve(params);

    // Call RPC with tenant_id from JWT (RLS enforces automatically)
    const { data, error } = await supabase
      .schema('supply_chain')
      .rpc('rpc_get_po_receiving_detail', {
        p_tenant_id: context.tenantId,
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
