/**
 * Receipt Confirmation API
 * POST /api/supply-chain/receipts/[id]/confirm - Confirm receipt and post to inventory
 */

import { NextRequest, NextResponse } from 'next/server';
import { createUserClient } from '@/lib/db-middleware';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, tenantId } = await createUserClient(request);
    const { id } = await Promise.resolve(params);

    // Call RPC to confirm receipt
    const { data, error } = await supabase
      .rpc('rpc_confirm_receipt', {
        p_receipt_id: id,
      });

    if (error) {
      console.error('Error confirming receipt:', error);
      
      if (error.message?.includes('not found')) {
        return NextResponse.json({ error: 'Receipt not found' }, { status: 404 });
      }
      
      if (error.message?.includes('Cannot confirm')) {
        return NextResponse.json(
          { error: 'Cannot confirm this receipt', details: error.message },
          { status: 400 }
        );
      }
      
      return NextResponse.json(
        { error: 'Failed to confirm receipt', details: error.message },
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
