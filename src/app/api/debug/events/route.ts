import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(request: NextRequest) {
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

    // Get recent events from outbox
    const { data: events, error: eventsError } = await supabase
      .schema('inventory')
      .from('events_outbox')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (eventsError) {
      console.error('Error fetching events:', eventsError);
      return NextResponse.json(
        { error: 'Failed to fetch events' },
        { status: 500 }
      );
    }

    // Get stats
    let stats = null;
    try {
      const result = await supabase.rpc('get_event_catalog_stats');
      stats = result.data;
      if (result.error) {
        console.error('Error fetching stats:', result.error);
      }
    } catch (statsError) {
      console.error('Error calling get_event_catalog_stats:', statsError);
    }

    // Get event definitions (catalog)
    const { data: definitions, error: defsError } = await supabase
      .from('event_definitions')
      .select('*')
      .order('event_name', { ascending: true });

    if (defsError) {
      console.error('Error fetching event definitions:', defsError);
      // Don't fail the whole request if catalog is missing
    }

    // Get last emitted timestamp for each event type
    const { data: lastEmitted, error: lastEmittedError } = await supabase
      .schema('inventory')
      .from('events_outbox')
      .select('event_type, created_at')
      .order('created_at', { ascending: false });

    const lastEmittedMap: Record<string, string> = {};
    if (lastEmitted) {
      lastEmitted.forEach((event: any) => {
        if (!lastEmittedMap[event.event_type]) {
          lastEmittedMap[event.event_type] = event.created_at;
        }
      });
    }

    return NextResponse.json({
      events: events || [],
      stats: stats || null,
      definitions: definitions || [],
      lastEmitted: lastEmittedMap
    });
  } catch (error) {
    console.error('Error in events debug endpoint:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
