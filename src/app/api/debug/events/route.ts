import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedClientOrThrow } from '@/lib/secure-server-client';

export async function GET(request: NextRequest) {
  try {
    // SECURITY: Admin-only debug endpoint
    const auth = await createAuthenticatedClientOrThrow(request);
    if (auth instanceof NextResponse) return auth;

    const { client: supabase, context } = auth;

    if (context.role !== 'admin') {
      return NextResponse.json(
        { error: 'Forbidden - admin access required' },
        { status: 403 }
      );
    }

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
      const result = await supabase.schema('public').rpc('get_event_catalog_stats');
      stats = result.data;
      if (result.error) {
        console.error('Error fetching stats:', result.error);
      }
    } catch (statsError) {
      console.error('Error calling get_event_catalog_stats:', statsError);
    }

    // Get event definitions (catalog)
    console.log('Fetching event definitions...');
    const { data: definitions, error: defsError } = await supabase
      .schema('public')
      .from('event_definitions')
      .select('*')
      .order('event_name', { ascending: true });

    console.log('Event definitions result:', {
      count: definitions?.length,
      error: defsError,
      sampleEvent: definitions?.[0]
    });

    if (defsError) {
      console.error('Error fetching event definitions:', defsError);
      // Return the error details so we can see what's wrong
      return NextResponse.json({
        events: events || [],
        stats: stats || null,
        definitions: [],
        definitionsError: defsError,
        lastEmitted: {}
      });
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
      { 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}

