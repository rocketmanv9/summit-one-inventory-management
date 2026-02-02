import { NextRequest, NextResponse } from 'next/server';
import { createUserClient } from '@/lib/db-middleware';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, tenantId } = await createUserClient(request);
    
    // ENFORCE IDEMPOTENCY (STRICT)
    let idempotencyKey: string;
    try {
      const { requireIdempotencyKey } = await import('@/lib/db-middleware');
      idempotencyKey = await requireIdempotencyKey(request);
    } catch (error: any) {
      return NextResponse.json(
        { error: error.message || 'Idempotency-Key header required for shipping transfer' },
        { status: 400 }
      );
    }
    
    const { id } = await params;

    console.log('[Ship Transfer] Attempting to ship transfer:', { id, tenantId });

    // First, validate that the transfer has sufficient stock at source location
    const { data: transfer, error: transferError } = await supabase
      .schema('inventory')
      .from('transfers')
      .select(`
        id,
        status,
        from_location_id,
        from_location:locations!transfers_from_location_id_fkey(name),
        transfer_lines(
          catalog_item_id,
          qty,
          catalog_items(name)
        )
      `)
      .eq('id', id)
      .single();

    if (transferError || !transfer) {
      console.error('[Ship Transfer] Transfer not found:', transferError);
      return NextResponse.json(
        { error: 'Transfer not found' },
        { status: 404 }
      );
    }

    if (transfer.status !== 'draft') {
      return NextResponse.json(
        { error: 'Only draft transfers can be shipped' },
        { status: 400 }
      );
    }

    // Validate stock availability for all lines
    for (const line of (transfer.transfer_lines as any[])) {
      const { data: stockBalance, error: stockError } = await supabase
        .schema('inventory')
        .from('stock_balances')
        .select('qty_on_hand')
        .eq('catalog_item_id', line.catalog_item_id)
        .eq('location_id', transfer.from_location_id)
        .single();

      if (stockError || !stockBalance) {
        return NextResponse.json(
          { 
            error: `Item "${line.catalog_items?.name}" has no inventory at location "${(transfer.from_location as any)?.name}". Cannot ship transfer.` 
          },
          { status: 400 }
        );
      }

      if (stockBalance.qty_on_hand < line.qty) {
        return NextResponse.json(
          { 
            error: `Insufficient stock for item "${line.catalog_items?.name}" at location "${(transfer.from_location as any)?.name}". Available: ${stockBalance.qty_on_hand}, Needed: ${line.qty}` 
          },
          { status: 400 }
        );
      }
    }

    // Fetch transfer lines to set qty_shipped
    const { data: lines, error: fetchLinesError } = await supabase
      .schema('inventory')
      .from('transfer_lines')
      .select('id, qty')
      .eq('transfer_id', id)
      .eq('tenant_id', tenantId);

    if (fetchLinesError || !lines) {
      console.error('Error fetching transfer lines:', fetchLinesError);
      return NextResponse.json(
        { error: 'Failed to fetch transfer lines' },
        { status: 500 }
      );
    }

    // Set qty_shipped = qty for all lines (full shipment by default)
    for (const line of lines) {
      const { error: updateError } = await supabase
        .schema('inventory')
        .from('transfer_lines')
        .update({ qty_shipped: line.qty })
        .eq('id', line.id)
        .eq('tenant_id', tenantId);

      if (updateError) {
        console.error('Error updating transfer line:', updateError);
        return NextResponse.json(
          { error: 'Failed to update transfer line quantities' },
          { status: 500 }
        );
      }
    }

    // Update transfer status to in_transit (marks as shipped)
    const { data, error } = await supabase
      .schema('inventory')
      .from('transfers')
      .update({
        status: 'in_transit',
        initiated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('status', 'draft') // Only ship if in draft status
      .select()
      .single();

    console.log('[Ship Transfer] Result:', { data, error });

    if (error) {
      console.error('Error shipping transfer:', error);
      return NextResponse.json(
        { error: 'Failed to ship transfer', details: error },
        { status: 500 }
      );
    }

    if (!data) {
      console.log('[Ship Transfer] No data returned - transfer may not be in draft status');
      return NextResponse.json(
        { error: 'Transfer not found or not in draft status' },
        { status: 404 }
      );
    }

    console.log('[Ship Transfer] Success!');
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
