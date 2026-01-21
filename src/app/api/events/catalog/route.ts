import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Force dynamic
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Use service role to bypass RLS
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // Get event definitions
    const { data: events, error } = await supabase
      .from('event_definitions')
      .select('*')
      .order('event_name', { ascending: true });

    if (error) {
      console.error('Error fetching event definitions:', error);
      return NextResponse.json(
        { error: error.message, details: error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      count: events?.length || 0,
      events: events || []
    });
  } catch (error) {
    console.error('Exception in event catalog route:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    );
  }
}
