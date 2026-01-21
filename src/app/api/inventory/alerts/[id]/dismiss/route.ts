import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/supabase/client';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = createClient();
    const { id } = await params;
    const { reason } = await request.json();

    // Authentication check
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Call the RPC function to dismiss alert
    const { error } = await supabase.rpc('rpc_dismiss_alert', {
      p_alert_id: id,
      p_reason: reason
    });

    if (error) {
      console.error('Error dismissing alert:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
