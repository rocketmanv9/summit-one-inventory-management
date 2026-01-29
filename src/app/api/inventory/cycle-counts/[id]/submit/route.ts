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

    // Submit the cycle count for review
    const updateData: any = { 
      status: 'under_review',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    if (userId) {
      updateData.updated_by = userId;
    }

    const { error } = await supabase
      .schema('inventory')
      .from('cycle_counts')
      .update(updateData)
      .eq('id', cycleCountId)
      .eq('tenant_id', tenantId);

    if (error) {
      console.error('Error submitting cycle count:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to submit cycle count for review' },
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      data: { 
        success: true,
        message: 'Cycle count submitted for review successfully'
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
