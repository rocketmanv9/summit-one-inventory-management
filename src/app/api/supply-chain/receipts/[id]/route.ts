/**
 * Receipt Detail API
 * GET /api/supply-chain/receipts/[id] - Get receipt detail
 * PATCH /api/supply-chain/receipts/[id] - Update receipt
 * DELETE /api/supply-chain/receipts/[id] - Cancel receipt
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdFromHeaders, getUserIdFromHeaders } from '@/lib/db-middleware';
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

    // Call RPC to get receipt detail
    const { data, error } = await supabase
      .rpc('rpc_get_receipt_detail', {
        p_receipt_id: id,
      })
      .single();

    if (error) {
      console.error('Error fetching receipt detail:', error);
      
      if (error.message?.includes('not found')) {
        return NextResponse.json({ error: 'Receipt not found' }, { status: 404 });
      }
      
      return NextResponse.json(
        { error: 'Failed to fetch receipt detail', details: error.message },
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

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const tenantId = getTenantIdFromHeaders(request.headers);
  const userId = getUserIdFromHeaders(request.headers);

  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const { id } = await Promise.resolve(params);
    const body = await request.json();
    const { notes, packing_slip_no, vendor_invoice_no } = body;

    const supabase = createClient();

    // Only allow updating certain fields on draft receipts
    // Check current status first
    const { data: receipt, error: fetchError } = await supabase
      .schema('supply_chain')
      .from('receipts')
      .select('status')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single();

    if (fetchError || !receipt) {
      return NextResponse.json({ error: 'Receipt not found' }, { status: 404 });
    }

    if (receipt.status !== 'draft') {
      return NextResponse.json(
        { error: 'Can only update draft receipts' },
        { status: 400 }
      );
    }

    // Update receipt
    const updateData: any = {
      updated_at: new Date().toISOString(),
      updated_by: userId,
    };

    if (notes !== undefined) updateData.notes = notes;
    if (packing_slip_no !== undefined) updateData.packing_slip_no = packing_slip_no;
    if (vendor_invoice_no !== undefined) updateData.vendor_invoice_no = vendor_invoice_no;

    const { data: updated, error: updateError } = await supabase
      .schema('supply_chain')
      .from('receipts')
      .update(updateData)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating receipt:', updateError);
      return NextResponse.json(
        { error: 'Failed to update receipt', details: updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: updated,
      meta: { tenantId, userId },
    });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const tenantId = getTenantIdFromHeaders(request.headers);

  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const { id } = await Promise.resolve(params);
    const { searchParams } = new URL(request.url);
    const reason = searchParams.get('reason');

    const supabase = createClient();

    // Call RPC to cancel receipt
    const { data, error } = await supabase
      .rpc('rpc_cancel_receipt', {
        p_receipt_id: id,
        p_reason: reason || null,
      });

    if (error) {
      console.error('Error cancelling receipt:', error);
      
      if (error.message?.includes('not found')) {
        return NextResponse.json({ error: 'Receipt not found' }, { status: 404 });
      }
      
      if (error.message?.includes('Cannot cancel')) {
        return NextResponse.json(
          { error: 'Cannot cancel this receipt', details: error.message },
          { status: 400 }
        );
      }
      
      return NextResponse.json(
        { error: 'Failed to cancel receipt', details: error.message },
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
