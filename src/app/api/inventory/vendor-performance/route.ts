import { NextRequest, NextResponse } from 'next/server';
import { createUserClient } from '@/lib/db-middleware';

export async function GET(request: NextRequest) {
  try {
    const { supabase } = await createUserClient(request);

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

