import { NextRequest, NextResponse } from 'next/server';
import { createUserClient } from '@/lib/db-middleware';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase } = await createUserClient(request);
    const { id } = await params;
    const { reason_code } = await request.json();

    // Call the RPC function to reverse the movement
    const { data, error } = await supabase.rpc('rpc_reverse_stock_movement', {
      p_movement_id: id,
      p_reason_code: reason_code
    });

    if (error) {
      console.error('Error reversing movement:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data, success: true });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
