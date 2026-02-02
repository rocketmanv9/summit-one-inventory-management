/**
 * Receipt Validation API
 * POST /api/supply-chain/receipts/[id]/validate - Validate receipt before confirmation
 */

import { NextRequest, NextResponse } from 'next/server';
import { createUserClient } from '@/lib/db-middleware';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, tenantId } = await createUserClient(request);

    // ENFORCE IDEMPOTENCY
    let idempotencyKey: string;
    try {
      const { requireIdempotencyKey } = await import('@/lib/db-middleware');
      idempotencyKey = await requireIdempotencyKey(request);
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const { id } = await Promise.resolve(params);

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
