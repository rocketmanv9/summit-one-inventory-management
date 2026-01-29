import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdFromHeaders } from '@/lib/db-middleware';
import { createClient } from '@/lib/db-middleware';

/**
 * POST /api/inventory/rfid/bulk-assignment/[session_id]/add-tag
 * Add a tag to a bulk assignment session
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { session_id: string } }
) {
  const tenantId = getTenantIdFromHeaders(request.headers);

  if (!tenantId) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }

  try {
    const sessionId = params.session_id;
    const body = await request.json();
    const { epc_hex, asset_id } = body;

    if (!epc_hex || !asset_id) {
      return NextResponse.json(
        { error: 'epc_hex and asset_id are required' },
        { status: 400 }
      );
    }

    const supabase = createClient();

    // Call RPC function to add tag to session
    const { data, error } = await supabase.rpc('rfid_add_tag_to_bulk_session', {
      p_session_id: sessionId,
      p_epc_hex: epc_hex,
      p_asset_id: asset_id
    });

    if (error) {
      console.error('Error adding tag to bulk session:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to add tag to session' },
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      data,
      message: 'Tag added to bulk assignment session'
    });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
