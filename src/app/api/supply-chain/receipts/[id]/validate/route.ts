/**
 * Receipt Validation API
 * POST /api/supply-chain/receipts/[id]/validate - Validate receipt before confirmation
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdFromHeaders } from '@/lib/db-middleware';
import { createClient } from '@/lib/db-middleware';

export async function POST(
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

    // Call RPC to validate receipt
    const { data, error } = await supabase
      .rpc('rpc_validate_receipt', {
        p_receipt_id: id,
      })
      .single();

    if (error) {
      console.error('Error validating receipt:', error);
      return NextResponse.json(
        { error: 'Failed to validate receipt', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data,
      meta: { tenantId },
    });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
