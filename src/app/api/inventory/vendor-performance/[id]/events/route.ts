import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/supabase/client';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient();
    const { id } = params;

    // Authentication check
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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
