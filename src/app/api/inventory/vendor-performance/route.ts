import { NextResponse } from 'next/server';
import { createClient } from '@/supabase/client';

export async function GET() {
  try {
    const supabase = createClient();

    // Authentication check
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch vendor performance summary
    const { data, error } = await supabase
      .from('v_vendor_performance_summary')
      .select('*')
      .order('overall_rating', { ascending: false, nullsFirst: false });

    if (error) {
      console.error('Error fetching vendor performance:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
