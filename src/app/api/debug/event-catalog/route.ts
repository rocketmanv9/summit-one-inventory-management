import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(request: NextRequest) {
  try {
    // Try service role first, fall back to anon key
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey || anonKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // Get all event definitions with stats
    const { data: stats, error: statsError } = await supabase
      .rpc('get_event_catalog_stats');

    if (statsError) {
      console.error('Error fetching event catalog stats:', statsError);
      return NextResponse.json(
        { error: 'Failed to fetch event catalog' },
        { status: 500 }
      );
    }

    // Get all event definitions with full details
    const { data: definitions, error: defsError, count } = await supabase
      .schema('public')
      .from('event_definitions')
      .select('*', { count: 'exact' })
      .range(0, 999)  // Explicitly request rows 0-999
      .order('event_name', { ascending: true });

    console.log('Fetched event definitions count:', definitions?.length, 'Total count:', count);
    console.log('Event names with inventory prefix:', definitions?.filter(d => d.event_name.startsWith('inventory.')).map(d => d.event_name));

    if (defsError) {
      console.error('Error fetching event definitions:', defsError);
      return NextResponse.json(
        { error: 'Failed to fetch event definitions' },
        { status: 500 }
      );
    }

    // Get consumers
    const { data: consumers, error: consumersError } = await supabase
      .from('event_consumers')
      .select('*')
      .order('event_name', { ascending: true });

    if (consumersError) {
      console.error('Error fetching event consumers:', consumersError);
    }

    return NextResponse.json({
      definitions: definitions || [],
      stats: stats || [],
      consumers: consumers || []
    });
  } catch (error) {
    console.error('Error in event catalog endpoint:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
