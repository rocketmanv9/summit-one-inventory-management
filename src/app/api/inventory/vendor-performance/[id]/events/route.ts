import { NextRequest, NextResponse } from 'next/server';
import { createUserClient } from '@/lib/db-middleware';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase } = await createUserClient(request);
    const { id } = await params;

    // Fetch vendor performance events
    const { data, error } = await supabase
      .from('vendor_performance_events')
      .select('*')
      .eq('vendor_id', id)
      .order('event_date', { ascending: false })
      .limit(50);

    if (error) {
      console.error('Error fetching vendor events:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
