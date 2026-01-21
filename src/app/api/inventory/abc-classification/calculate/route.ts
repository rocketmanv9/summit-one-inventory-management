import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/supabase/client';

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient();
    const { method = 'value' } = await request.json();

    // Authentication check
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Call the RPC function to calculate ABC classification
    const { data, error } = await supabase.rpc('rpc_calculate_abc_classification', {
      p_method: method
    });

    if (error) {
      console.error('Error calculating ABC classification:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // data is an array with one row containing the counts
    const result = data && data.length > 0 ? data[0] : {
      items_classified: 0,
      class_a_count: 0,
      class_b_count: 0,
      class_c_count: 0,
      class_d_count: 0
    };

    return NextResponse.json({
      success: true,
      items_classified: result.items_classified || 0,
      class_a: result.class_a_count || 0,
      class_b: result.class_b_count || 0,
      class_c: result.class_c_count || 0,
      class_d: result.class_d_count || 0
    });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
