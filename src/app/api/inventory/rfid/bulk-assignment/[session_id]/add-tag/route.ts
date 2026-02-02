import { NextRequest, NextResponse } from 'next/server';
import { createDeviceClient, deviceAuthError } from '@/lib/device-auth';

/**
 * POST /api/inventory/rfid/bulk-assignment/[session_id]/add-tag
 * Add a tag to a bulk assignment session
 * 
 * SECURITY: Machine endpoint - requires device token
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ session_id: string }> }
) {
  try {
    const { supabase, deviceId, tenantId } = await createDeviceClient(request);
    // ENFORCE IDEMPOTENCY
    let idempotencyKey: string;
    try {
      const { requireIdempotencyKey } = await import('@/lib/db-middleware');
      idempotencyKey = await requireIdempotencyKey(request);
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const { session_id: sessionId } = await params;
    const body = await request.json();
    const { epc_hex, asset_id } = body;

    if (!epc_hex || !asset_id) {
      return NextResponse.json(
        { error: 'epc_hex and asset_id are required' },
        { status: 400 }
      );
    }

    // Verify session belongs to this device and tenant
    const { data: session, error: sessionError } = await supabase
      .schema('inventory')
      .from('rfid_bulk_assignment_sessions')
      .select('id, status')
      .eq('id', sessionId)
      .eq('tenant_id', tenantId)
      .eq('device_id', deviceId)
      .eq('status', 'active')
      .single();

    if (sessionError || !session) {
      return NextResponse.json(
        { error: 'Invalid or inactive session' },
        { status: 404 }
      );
    }

    // Add tag assignment (implementation depends on your schema)
    // This is a placeholder - adjust based on your actual table structure
    const { data, error } = await supabase
      .schema('inventory')
      .from('rfid_tags')
      .upsert({
        tenant_id: tenantId,
        epc_hex,
        asset_id,
        assigned_via_device_id: deviceId,
        assignment_method: 'bulk_manual',
        assignment_session_id: sessionId,
        assigned_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      console.error('[RFID Bulk Assignment] Error adding tag:', error);
      return NextResponse.json(
        { error: 'Failed to add tag to session' },
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      data,
      message: 'Tag added to bulk assignment session'
    });
  } catch (error: any) {
    if (error.message?.includes('token')) {
      return deviceAuthError(error.message);
    }
    console.error('[RFID Bulk Assignment] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
