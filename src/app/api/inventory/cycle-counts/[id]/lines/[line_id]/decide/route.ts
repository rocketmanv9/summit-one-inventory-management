import { NextRequest, NextResponse } from 'next/server';
import { createUserClient } from '@/lib/db-middleware';

/**
 * POST /api/inventory/cycle-counts/[id]/lines/[line_id]/decide
 * Make a variance decision: accept, reject, or investigate
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; line_id: string }> }
) {
  try {
    const { supabase, tenantId, userId } = await createUserClient(request);

    // ENFORCE IDEMPOTENCY
    let idempotencyKey: string;
    try {
      const { requireIdempotencyKey } = await import('@/lib/db-middleware');
      idempotencyKey = await requireIdempotencyKey(request);
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const { id: cycleCountId, line_id: lineId } = await params;
    const body = await request.json();
    const { decision, reason, notes } = body;

    // Validate decision
    const validDecisions = ['pending', 'accepted', 'rejected', 'investigating'];
    if (!validDecisions.includes(decision)) {
      return NextResponse.json(
        { error: 'Invalid decision. Must be: pending, accepted, rejected, or investigating' },
        { status: 400 }
      );
    }

    // Validate reason for accepted decisions
    const validReasons = [
      'usage_not_recorded',
      'transfer_not_recorded',
      'loss_theft',
      'damage_disposal',
      'counting_error',
      'receiving_error',
      'bulk_drift',
      'unknown'
    ];

    if (decision === 'accepted' && reason && !validReasons.includes(reason)) {
      return NextResponse.json(
        { error: `Invalid reason. Must be one of: ${validReasons.join(', ')}` },
        { status: 400 }
      );
    }

    // Get the cycle count line with variance details for event emission
    const { data: line, error: fetchError } = await supabase
      .schema('inventory')
      .from('cycle_count_lines')
      .select('id, cycle_count_id, catalog_item_id, variance, qty_counted, qty_expected')
      .eq('id', lineId)
      .eq('cycle_count_id', cycleCountId)
      .single();

    if (fetchError || !line) {
      return NextResponse.json({ error: 'Cycle count line not found' }, { status: 404 });
    }

    // Update the line with decision
    const updateData: any = {
      decision_status: decision,
      decision_reason: reason || null,
      decision_notes: notes || null,
      decided_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Only add decided_by if userId exists (optional field)
    if (userId) {
      updateData.decided_by_user_id = userId;
    }

    const { data, error } = await supabase
      .schema('inventory')
      .from('cycle_count_lines')
      .update(updateData)
      .eq('id', lineId)
      .eq('cycle_count_id', cycleCountId)
      .select()
      .single();

    if (error) {
      console.error('Error updating variance decision:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to update decision' },
        { status: 500 }
      );
    }

    // Emit events based on decision type
    if (decision === 'rejected') {
      try {
        await supabase.rpc('publish_event', {
          p_tenant_id: tenantId,
          p_scope: 'inventory',
          p_event_type: 'inventory.cycle_count.rejected',
          p_aggregate_type: 'cycle_count_line',
          p_aggregate_id: lineId,
          p_payload: {
            cycle_count_id: cycleCountId,
            line_id: lineId,
            catalog_item_id: line.catalog_item_id,
            variance: line.variance,
            qty_counted: line.qty_counted,
            qty_expected: line.qty_expected,
            reason: reason || 'not_specified',
            notes: notes || null,
            rejected_by: userId
          }
        });
      } catch (err: any) {
        console.error('Failed to emit rejection event:', err);
      }
    }

    // If investigating, emit event to flag for follow-up
    if (decision === 'investigating') {
      try {
        await supabase.rpc('publish_event', {
          p_tenant_id: tenantId,
          p_scope: 'inventory',
          p_event_type: 'inventory.variance.investigation_needed',
          p_aggregate_type: 'cycle_count_line',
          p_aggregate_id: lineId,
          p_payload: {
            cycle_count_id: cycleCountId,
            line_id: lineId,
            catalog_item_id: line.catalog_item_id,
            variance: line.variance,
            qty_counted: line.qty_counted,
            qty_expected: line.qty_expected,
            reason: reason || null,
            notes: notes || null,
            flagged_by: userId
          }
        });
      } catch (err: any) {
        console.error('Failed to emit investigation event:', err);
      }
    }

    return NextResponse.json({
      data,
      message: `Variance ${decision}`
    });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
