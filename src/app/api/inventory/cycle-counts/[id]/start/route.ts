import { NextRequest, NextResponse } from 'next/server';
import { createUserClient } from '@/lib/db-middleware';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, tenantId, userId } = await createUserClient(request);
    
    // ENFORCE IDEMPOTENCY (STRICT)
    let idempotencyKey: string;
    try {
      const { requireIdempotencyKey } = await import('@/lib/db-middleware');
      idempotencyKey = await requireIdempotencyKey(request);
    } catch (error: any) {
      return NextResponse.json(
        { error: error.message || 'Idempotency-Key header required for starting cycle count' },
        { status: 400 }
      );
    }
    
    const { id: cycleCountId } = await params;

    // First, get the cycle count details
    const { data: cycleCount, error: fetchError } = await supabase
      .schema('inventory')
      .from('cycle_counts')
      .select('location_id, count_type, is_blind')
      .eq('id', cycleCountId)
      .single();

    if (fetchError || !cycleCount) {
      return NextResponse.json(
        { error: 'Cycle count not found' },
        { status: 404 }
      );
    }

    // Get all stock at the location
    const { data: stockBalances, error: stockError } = await supabase
      .schema('inventory')
      .from('stock_balances')
      .select('catalog_item_id, qty_on_hand')
      .eq('location_id', cycleCount.location_id)
      .gt('qty_on_hand', 0);

    if (stockError) {
      console.error('Error fetching stock:', stockError);
      return NextResponse.json(
        { error: 'Failed to fetch stock balances' },
        { status: 500 }
      );
    }

    // Create cycle count lines from stock balances
    if (stockBalances && stockBalances.length > 0) {
      const lines = stockBalances.map((sb: any, index: number) => ({
        tenant_id: tenantId,
        cycle_count_id: cycleCountId,
        line_number: index + 1,
        catalog_item_id: sb.catalog_item_id,
        location_id: cycleCount.location_id,
        qty_expected: sb.qty_on_hand,
        qty_counted: null,
        last_event_id: `start_${cycleCountId}_line_${index + 1}`
      }));

      const { error: linesError } = await supabase
        .schema('inventory')
        .from('cycle_count_lines')
        .insert(lines);

      if (linesError) {
        console.error('Error creating count lines:', linesError);
        return NextResponse.json(
          { error: 'Failed to create count lines' },
          { status: 500 }
        );
      }
    }

    // Update the cycle count status to in_progress
    const updateData: any = { 
      status: 'in_progress',
      started_at: new Date().toISOString(),
      snapshot_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    if (userId) {
      updateData.updated_by = userId;
    }

    const { error: updateError } = await supabase
      .schema('inventory')
      .from('cycle_counts')
      .update(updateData)
      .eq('id', cycleCountId);

    if (updateError) {
      console.error('Error updating cycle count:', updateError);
      return NextResponse.json(
        { error: updateError.message || 'Failed to start cycle count' },
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      data: { 
        success: true,
        message: 'Cycle count started successfully',
        lines_created: stockBalances?.length || 0
      } 
    });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
