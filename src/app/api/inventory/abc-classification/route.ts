import { NextRequest, NextResponse } from 'next/server';
import { createUserClient } from '@/lib/db-middleware';

export async function GET(request: NextRequest) {
  try {
    const { supabase } = await createUserClient(request);

    // Fetch current ABC classification
    const { data, error } = await supabase
      .from('v_current_abc_classification')
      .select('*')
      .order('value_rank', { ascending: true, nullsFirst: false });

    if (error) {
      console.error('Error fetching ABC classification:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

