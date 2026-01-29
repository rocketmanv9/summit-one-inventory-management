import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdFromHeaders } from '@/lib/db-middleware';
import { createClient } from '@/lib/db-middleware';

/**
 * POST /api/inventory/rfid/bulk-assignment/[session_id]/complete
 * Complete a bulk assignment session
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

    const supabase = createClient();

    // Call RPC function to complete bulk assignment session
    const { data, error } = await supabase.rpc('rfid_complete_bulk_assignment_session', {
      p_session_id: sessionId
    });

    if (error) {
      console.error('Error completing bulk assignment session:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to complete bulk assignment session' },
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      data,
      message: 'Bulk assignment session completed successfully'
    });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
