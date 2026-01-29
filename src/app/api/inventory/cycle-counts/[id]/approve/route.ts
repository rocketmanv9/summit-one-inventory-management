import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdFromHeaders, getUserIdFromHeaders } from '@/lib/db-middleware';
import { createClient } from '@/lib/db-middleware';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const tenantId = getTenantIdFromHeaders(request.headers);
  const userId = getUserIdFromHeaders(request.headers);

  if (!tenantId) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }

  try {
    const { id: cycleCountId } = await params;
    const supabase = createClient();

    // Approve and post the cycle count
    const updateData: any = { 
      status: 'posted',
      approved_at: new Date().toISOString(),
      posted_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    if (userId) {
      updateData.approved_by_user_id = userId;
      updateData.updated_by = userId;
    }

    const { error } = await supabase
      .schema('inventory')
      .from('cycle_counts')
      .update(updateData)
      .eq('id', cycleCountId)
      .eq('tenant_id', tenantId);

    if (error) {
      console.error('Error approving cycle count:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to approve and post cycle count' },
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      data: { 
        success: true,
        message: 'Cycle count approved and posted successfully'
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
