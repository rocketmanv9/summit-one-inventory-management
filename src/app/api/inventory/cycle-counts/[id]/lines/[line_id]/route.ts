import { NextRequest, NextResponse } from 'next/server';
import { createUserClient, getIdempotencyKey } from '@/lib/db-middleware';

/**
 * PATCH /api/inventory/cycle-counts/[id]/lines/[line_id]
 * Update the actual count for a line
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; line_id: string }> }
) {
  try {
    const { supabase, tenantId } = await createUserClient(request);
    
    // ENFORCE IDEMPOTENCY
    let idempotencyKey: string | null;
    try {
      idempotencyKey = await getIdempotencyKey(request, 'PATCH');
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    
    if (!idempotencyKey) {
      return NextResponse.json(
        { error: 'Idempotency-Key header required for PATCH operations' },
        { status: 400 }
      );
    }
    
    const { id: cycleCountId, line_id: lineId } = await params;
    const body = await request.json();
    const { actual_qty } = body;

    if (actual_qty === undefined) {
      return NextResponse.json(
        { error: 'actual_qty is required' },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .schema('inventory')
      .from('cycle_count_lines')
      .update({
        qty_counted: actual_qty,
        counted_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', lineId)
      .eq('cycle_count_id', cycleCountId);

    if (error) {
      console.error('Error updating count line:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to update count line' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: { success: true },
      message: 'Count updated successfully'
    });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
