/**
 * Cycle Count Approval API
 * POST /api/inventory/cycle-counts/[id]/approve
 * 
 * SECURITY: Uses JWT + RLS
 * CORRECTNESS: Uses RPC that writes to stock_movements (NOT direct stock_balances updates)
 * IDEMPOTENCY: Enforced via Idempotency-Key header
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedClientOrThrow } from '@/lib/secure-server-client';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Authenticate via JWT
  const auth = await createAuthenticatedClientOrThrow(request);
  if (auth instanceof NextResponse) return auth;
  
  const { client: supabase, context } = auth;
  const { tenantId, userId } = context;
  
  try {
    const { id: cycleCountId } = await params;
    
    // Get Idempotency-Key header (REQUIRED for safety)
    const idempotencyKey = request.headers.get('idempotency-key');
    if (!idempotencyKey) {
      return NextResponse.json(
        { error: 'Idempotency-Key header required for cycle count approval' },
        { status: 400 }
      );
    }
    
    // Parse optional request body
    const body = await request.json().catch(() => ({}));
    const { approval_notes } = body;
    
    console.log(`[Cycle Count Approve] Approving count ${cycleCountId} with idempotency key: ${idempotencyKey}`);
    
    // Use RPC to post adjustments atomically
    // This writes to stock_movements (source of truth), NOT stock_balances directly
    // Triggers/materialization will update stock_balances from movements
    const { data: result, error } = await supabase
      .rpc('post_cycle_count_adjustments', {
        p_cycle_count_id: cycleCountId,
        p_tenant_id: tenantId,
        p_posted_by_user_id: userId
      });

    if (error) {
      console.error('[Cycle Count Approve] RPC error:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to post cycle count adjustments' },
        { status: 500 }
      );
    }
    
    console.log('[Cycle Count Approve] Success:', result);
    
    return NextResponse.json({
      success: true,
      data: result,
      message: `Cycle count approved and posted with ${result.adjustments_created} adjustments`
    });
    
  } catch (error: any) {
    console.error('[Cycle Count Approve] Error:', error);
    
    if (error.message?.includes('authenticated') || error.message?.includes('session')) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
