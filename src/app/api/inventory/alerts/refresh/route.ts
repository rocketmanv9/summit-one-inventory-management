import { NextResponse } from 'next/server';
import { createClient } from '@/supabase/client';

export async function POST() {
  try {
    const supabase = createClient();

    // Authentication check
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Call the generate_reorder_alerts function
    const { data, error } = await supabase.rpc('generate_reorder_alerts');

    if (error) {
      console.error('Error generating alerts:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // data is an array with one row containing the counts
    const result = data && data.length > 0 ? data[0] : { alerts_created: 0, alerts_updated: 0, alerts_auto_dismissed: 0 };

    return NextResponse.json({
      success: true,
      created: result.alerts_created || 0,
      updated: result.alerts_updated || 0,
      dismissed: result.alerts_auto_dismissed || 0
    });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
